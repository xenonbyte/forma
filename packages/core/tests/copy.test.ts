import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CopyService } from "../src/copy.js";
import { getProductMutationLock, type ProductMutationContext, type ProductMutationLock } from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function nextTick(): Promise<void> {
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));
}

async function lockProbeDelay(): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
}

function createRecordingLock(): ProductMutationLock & { calls: Array<{ operation: string; product_id?: string }> } {
  const calls: Array<{ operation: string; product_id?: string }> = [];
  return {
    calls,
    async run<T>(
      input: { operation: string; product_id?: string },
      fn: (context: ProductMutationContext) => Promise<T>
    ): Promise<T> {
      calls.push(input);
      return fn({ ...input, warnings: [] });
    }
  };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function createCopyService() {
  const home = await mkdtemp(join(tmpdir(), "forma-copy-"));
  const copy = new CopyService({ home });
  return { home, copy };
}

const productId = "P-123abc";
const requirementId = "R-12345678";

describe("CopyService", () => {
  it("serializes direct saveTranslations writes with the default home lock", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-copy-lock-"));
    const copy = new CopyService({ home });
    const release = deferred();
    const events: string[] = [];
    const hold = getProductMutationLock(home).run({ operation: "test_hold" }, async () => {
      events.push("hold-enter");
      await release.promise;
      events.push("hold-exit");
    });
    while (!events.includes("hold-enter")) {
      await nextTick();
    }

    let completed = false;
    const save = copy
      .saveTranslations(productId, requirementId, [
        { page_id: "login", entries: [{ context: "submit_button", texts: { en: "Login" } }] }
      ])
      .then(() => {
        completed = true;
      });
    await lockProbeDelay();

    expect(completed).toBe(false);
    release.resolve();
    await Promise.all([hold, save]);
    expect(events).toEqual(["hold-enter", "hold-exit"]);
    expect(completed).toBe(true);
  });

  it("uses stable operation names for direct copy mutations", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-copy-lock-"));
    const productMutationLock = createRecordingLock();
    const copy = new CopyService({ home, productMutationLock });

    await copy.saveTranslations(productId, requirementId, [
      { page_id: "login", entries: [{ context: "submit_button", texts: { en: "Login" } }] }
    ]);
    await copy.updatePageTranslations(productId, requirementId, "login", [
      { context: "submit_button", texts: { en: "Sign in" } }
    ]);
    await copy.mergeTranslations(
      productId,
      requirementId,
      { login: [{ context: "submit_button", text: "Login" }] },
      { login: [{ context: "submit_button", text: "Sign in" }] },
      []
    );

    expect(productMutationLock.calls).toEqual([
      { operation: "save_translations", product_id: productId },
      { operation: "update_page_translations", product_id: productId },
      { operation: "merge_translations", product_id: productId }
    ]);
  });

  it("holds one lock for page translation read-merge-write and does not call public save", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-copy-lock-"));
    const productMutationLock = createRecordingLock();
    const copy = new CopyService({ home, productMutationLock });
    await copy.saveTranslations(productId, requirementId, [
      { page_id: "login", entries: [{ context: "submit_button", texts: { en: "Login" } }] }
    ]);
    productMutationLock.calls.length = 0;
    copy.saveTranslations = async () => {
      throw new Error("public saveTranslations should not be called inside updatePageTranslations");
    };

    await copy.updatePageTranslations(productId, requirementId, "login", [
      { context: "submit_button", texts: { en: "Sign in" } }
    ]);

    expect(productMutationLock.calls).toEqual([{ operation: "update_page_translations", product_id: productId }]);
    await expect(copy.getTranslations(productId, requirementId)).resolves.toEqual([
      { page_id: "login", entries: [{ context: "submit_button", texts: { en: "Sign in" } }] }
    ]);
  });

  it("returns empty translations when no copy-translations.yaml exists", async () => {
    const { copy } = await createCopyService();

    await expect(copy.getTranslations(productId, requirementId)).resolves.toEqual([]);
  });

  it("writes and reads translations", async () => {
    const { copy } = await createCopyService();
    const translations = [
      {
        page_id: "login",
        entries: [{ context: "submit_button", texts: { en: "Login", ja: "ログイン" } }]
      }
    ];

    await copy.saveTranslations(productId, requirementId, translations);

    await expect(copy.getTranslations(productId, requirementId)).resolves.toEqual(translations);
  });

  it("clears outdated for page-level translation updates", async () => {
    const { copy } = await createCopyService();
    await copy.saveTranslations(productId, requirementId, [
      {
        page_id: "login",
        entries: [
          { context: "submit_button", texts: { en: "Login" }, outdated: true },
          { context: "forgot_link", texts: { en: "Forgot password?" }, outdated: true }
        ]
      },
      {
        page_id: "settings",
        entries: [{ context: "save_button", texts: { en: "Save" }, outdated: true }]
      }
    ]);

    await copy.updatePageTranslations(productId, requirementId, "login", [
      { context: "submit_button", texts: { en: "Sign in" }, outdated: true }
    ]);

    const updated = [
      {
        page_id: "login",
        entries: [
          { context: "forgot_link", texts: { en: "Forgot password?" }, outdated: true },
          { context: "submit_button", texts: { en: "Sign in" } }
        ]
      },
      {
        page_id: "settings",
        entries: [{ context: "save_button", texts: { en: "Save" }, outdated: true }]
      }
    ];
    await expect(copy.getTranslations(productId, requirementId)).resolves.toEqual(updated);
  });

  it("merges partial language maps for page-level translation updates", async () => {
    const { copy } = await createCopyService();
    await copy.saveTranslations(productId, requirementId, [
      {
        page_id: "login",
        entries: [{ context: "submit_button", texts: { en: "Login", ja: "ログイン" }, outdated: true }]
      }
    ]);

    await copy.updatePageTranslations(productId, requirementId, "login", [
      { context: "submit_button", texts: { en: "Sign in" } }
    ]);

    await expect(copy.getTranslations(productId, requirementId)).resolves.toEqual([
      {
        page_id: "login",
        entries: [{ context: "submit_button", texts: { en: "Sign in", ja: "ログイン" } }]
      }
    ]);
  });

  it("marks existing translations outdated when default copy text changes", async () => {
    const home = await mkdtemp(join(tmpdir(), "forma-copy-"));
    const copy = new CopyService({ home });
    const productId = "P-123abc";
    const requirementId = "R-12345678";

    await copy.saveTranslations(productId, requirementId, [
      {
        page_id: "login",
        entries: [{ context: "submit_button", texts: { en: "Login" } }]
      }
    ]);

    const merged = await copy.mergeTranslations(
      productId,
      requirementId,
      { login: [{ context: "submit_button", text: "登录" }] },
      { login: [{ context: "submit_button", text: "立即登录" }] },
      []
    );

    expect(merged[0]?.entries[0]).toMatchObject({
      context: "submit_button",
      outdated: true,
      texts: { en: "Login" }
    });
  });

  it("preserves translations for deleted source-copy entries", async () => {
    const { copy } = await createCopyService();
    await copy.saveTranslations(productId, requirementId, [
      {
        page_id: "login",
        entries: [
          { context: "submit_button", texts: { en: "Login" } },
          { context: "forgot_link", texts: { en: "Forgot password?" } }
        ]
      }
    ]);

    const merged = await copy.mergeTranslations(
      productId,
      requirementId,
      {
        login: [
          { context: "submit_button", text: "登录" },
          { context: "forgot_link", text: "忘记密码？" }
        ]
      },
      { login: [{ context: "submit_button", text: "登录" }] },
      []
    );

    expect(merged).toEqual([
      {
        page_id: "login",
        entries: [
          { context: "forgot_link", texts: { en: "Forgot password?" } },
          { context: "submit_button", texts: { en: "Login" } }
        ]
      }
    ]);
  });

  it("marks preserved translations outdated when their source-copy context is reintroduced", async () => {
    const { copy } = await createCopyService();
    await copy.saveTranslations(productId, requirementId, [
      {
        page_id: "login",
        entries: [{ context: "forgot_link", texts: { en: "Forgot password?" } }]
      }
    ]);

    const merged = await copy.mergeTranslations(
      productId,
      requirementId,
      { login: [{ context: "submit_button", text: "登录" }] },
      {
        login: [
          { context: "submit_button", text: "登录" },
          { context: "forgot_link", text: "忘记密码？" }
        ]
      },
      []
    );

    expect(merged).toEqual([
      {
        page_id: "login",
        entries: [{ context: "forgot_link", texts: { en: "Forgot password?" }, outdated: true }]
      }
    ]);
  });

  it("does not mark fresh replacement translations outdated", async () => {
    const { copy } = await createCopyService();
    await copy.saveTranslations(productId, requirementId, [
      {
        page_id: "login",
        entries: [{ context: "submit_button", texts: { en: "Login" } }]
      }
    ]);

    const merged = await copy.mergeTranslations(
      productId,
      requirementId,
      { login: [{ context: "submit_button", text: "登录" }] },
      { login: [{ context: "submit_button", text: "立即登录" }] },
      [
        {
          page_id: "login",
          entries: [{ context: "submit_button", texts: { en: "Sign in" }, outdated: true }]
        }
      ]
    );

    expect(merged).toEqual([
      {
        page_id: "login",
        entries: [{ context: "submit_button", texts: { en: "Sign in" } }]
      }
    ]);
  });

  it("deletes copy-translations.yaml when saving an empty translation set", async () => {
    const { home, copy } = await createCopyService();
    const file = join(home, "data", productId, requirementId, "copy-translations.yaml");

    await copy.saveTranslations(productId, requirementId, [
      {
        page_id: "login",
        entries: [{ context: "submit_button", texts: { en: "Login" } }]
      }
    ]);
    expect(await fileExists(file)).toBe(true);

    await copy.saveTranslations(productId, requirementId, []);

    expect(await fileExists(file)).toBe(false);
    await expect(copy.getTranslations(productId, requirementId)).resolves.toEqual([]);
  });
});
