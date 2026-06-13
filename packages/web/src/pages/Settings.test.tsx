// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../LocaleContext.js";
import { getLocale, setLocale } from "../i18n.js";
import {
  ApiError,
  type MediaCatalogue,
  type MediaConfig,
  type MediaConfigInput,
  type MediaTestResult,
} from "../api.js";
import { Settings, type SettingsClient } from "./Settings.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
  vi.restoreAllMocks();
  setLocale("en");
});

// ── fixtures ────────────────────────────────────────────────────────────────

const catalogue: MediaCatalogue = {
  providers: [
    {
      id: "volcengine",
      label: "火山方舟 (Volcengine Ark)",
      hint: "Ark provider hint",
      defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      docsUrl: "https://www.volcengine.com/docs/82379/1541523",
    },
  ],
  models: [
    {
      id: "doubao-seedream-5-0-260128",
      label: "Doubao Seedream 5.0",
      hint: "best",
      provider: "volcengine",
      default: true,
    },
    { id: "doubao-seedream-5-0-lite-260128", label: "Doubao Seedream 5.0 lite", hint: "lite", provider: "volcengine" },
    { id: "other-model", label: "Other model", hint: "n/a", provider: "other-provider" },
  ],
};

const configNone: MediaConfig = { configured: false, source: "none" };
const configFile: MediaConfig = {
  configured: true,
  source: "file",
  model: "doubao-seedream-5-0-lite-260128",
  base_url: "https://ark.cn-beijing.volces.com/api/v3",
  api_key_tail: "wxyz",
};
const configEnv: MediaConfig = {
  configured: true,
  source: "env",
  model: "doubao-seedream-5-0-260128",
  base_url: "https://ark.cn-beijing.volces.com/api/v3",
};

function fakeClient(overrides: Partial<SettingsClient> = {}): SettingsClient {
  return {
    getMediaCatalogue: async () => catalogue,
    getMediaConfig: async () => configNone,
    saveMediaConfig: async () => configNone,
    testMediaConnection: async () => ({ ok: true }),
    ...overrides,
  };
}

// ── infra ─────────────────────────────────────────────────────────────────────

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function renderSettings(client: SettingsClient) {
  const { container, root } = createTestRoot();
  await act(async () => {
    root.render(
      <LocaleProvider>
        <Settings client={client} />
      </LocaleProvider>,
    );
    await flushPromises();
  });
  return { container, root };
}

function panel(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-settings-panel='image-model']");
  if (!el) throw new Error("missing image-model panel");
  return el;
}

function selectByName(container: HTMLElement, name: string): HTMLSelectElement {
  const el = panel(container).querySelector<HTMLSelectElement>(`select[name='${name}']`);
  if (!el) throw new Error(`missing select ${name}`);
  return el;
}

function inputByName(container: HTMLElement, name: string): HTMLInputElement {
  const el = panel(container).querySelector<HTMLInputElement>(`input[name='${name}']`);
  if (!el) throw new Error(`missing input ${name}`);
  return el;
}

function buttonByTestId(container: HTMLElement, testId: string): HTMLButtonElement {
  const el = panel(container).querySelector<HTMLButtonElement>(`button[data-testid='${testId}']`);
  if (!el) throw new Error(`missing button ${testId}`);
  return el;
}

/** Drive a controlled <select> change the way React expects in happy-dom. */
function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Settings — language switcher", () => {
  it("renders the language switcher in the settings content area", async () => {
    setLocale("en");
    const { container } = await renderSettings(fakeClient());

    expect(container.textContent).toContain("Language");
    const en = [...container.querySelectorAll("button")].find((b) => b.textContent === "EN");
    const zh = [...container.querySelectorAll("button")].find((b) => b.textContent === "中");
    expect(en?.getAttribute("aria-pressed")).toBe("true");
    expect(zh?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      zh?.click();
      await flushPromises();
    });

    expect(getLocale()).toBe("zh");
  });
});

describe("Settings — image model section", () => {
  it("renders the section and populates provider/model selects, preselecting the default model", async () => {
    const { container } = await renderSettings(fakeClient());

    expect(panel(container)).not.toBeNull();

    const provider = selectByName(container, "provider");
    expect([...provider.options].map((o) => o.value)).toEqual(["volcengine"]);
    expect(provider.value).toBe("volcengine");

    const model = selectByName(container, "model");
    // Only the selected provider's models appear; the default-flagged one is preselected.
    expect([...model.options].map((o) => o.value)).toEqual([
      "doubao-seedream-5-0-260128",
      "doubao-seedream-5-0-lite-260128",
    ]);
    expect(model.value).toBe("doubao-seedream-5-0-260128");
  });

  it("filters models to the selected provider", async () => {
    const { container } = await renderSettings(fakeClient());
    const model = selectByName(container, "model");
    // "other-model" belongs to "other-provider" and must not appear.
    expect([...model.options].map((o) => o.value)).not.toContain("other-model");
  });

  it("preselects the configured model from GET config", async () => {
    const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configFile }));
    expect(selectByName(container, "model").value).toBe("doubao-seedream-5-0-lite-260128");
  });

  it("falls back to the catalogue default when config.model is not in the provider's model list", async () => {
    const orphanConfig: MediaConfig = {
      ...configFile,
      model: "removed-old-model-id",
    };
    const saveSpy = vi.fn<(input: MediaConfigInput) => Promise<MediaConfig>>(async () => orphanConfig);
    const { container } = await renderSettings(
      fakeClient({ getMediaConfig: async () => orphanConfig, saveMediaConfig: saveSpy }),
    );

    // The rendered select must show the catalogue default, not the orphaned id.
    const modelSelect = selectByName(container, "model");
    expect(modelSelect.value).toBe("doubao-seedream-5-0-260128");
    expect([...modelSelect.options].map((o) => o.value)).not.toContain("removed-old-model-id");

    // A subsequent save must send the catalogue default, not the orphan.
    await act(async () => {
      buttonByTestId(container, "media-save").click();
      await flushPromises();
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0].model).toBe("doubao-seedream-5-0-260128");
  });

  it("disables the save button while save is in flight and re-enables after resolution", async () => {
    let resolveSave!: (config: MediaConfig) => void;
    const deferredSave = vi.fn<(input: MediaConfigInput) => Promise<MediaConfig>>(
      () =>
        new Promise<MediaConfig>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { container } = await renderSettings(
      fakeClient({ getMediaConfig: async () => configFile, saveMediaConfig: deferredSave }),
    );

    const saveBtn = buttonByTestId(container, "media-save");
    expect(saveBtn.disabled).toBe(false);

    // Click save — the promise is still pending.
    await act(async () => {
      saveBtn.click();
    });

    // Button must be disabled while the save is in flight.
    expect(saveBtn.disabled).toBe(true);

    // Resolve the deferred promise and flush.
    await act(async () => {
      resolveSave(configFile);
      await flushPromises();
    });

    // Button must be re-enabled after the save completes.
    expect(saveBtn.disabled).toBe(false);
  });

  describe("masked key display", () => {
    it("file-source shows the masked tail and a configured note", async () => {
      const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configFile }));
      const apiKey = inputByName(container, "api_key");
      expect(apiKey.disabled).toBe(false);
      expect(apiKey.placeholder).toContain("wxyz");
      expect(panel(container).textContent).toContain("••••wxyz");
    });

    it("env-source shows the env note and does not allow editing the key", async () => {
      const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configEnv }));
      const apiKey = inputByName(container, "api_key");
      expect(apiKey.disabled).toBe(true);
      expect(panel(container).textContent?.toLowerCase()).toMatch(/environment|环境变量/);
    });

    it("none-source shows an empty editable key prompting entry", async () => {
      const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configNone }));
      const apiKey = inputByName(container, "api_key");
      expect(apiKey.disabled).toBe(false);
      expect(apiKey.value).toBe("");
    });
  });

  describe("save payload", () => {
    it("sends preserve_api_key when model changes but no new key is entered", async () => {
      const saveSpy = vi.fn<(input: MediaConfigInput) => Promise<MediaConfig>>(async () => configFile);
      const { container } = await renderSettings(
        fakeClient({ getMediaConfig: async () => configFile, saveMediaConfig: saveSpy }),
      );

      setSelect(selectByName(container, "model"), "doubao-seedream-5-0-260128");

      await act(async () => {
        buttonByTestId(container, "media-save").click();
        await flushPromises();
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const payload = saveSpy.mock.calls[0][0];
      expect(payload.preserve_api_key).toBe(true);
      expect(payload.api_key).toBeUndefined();
      expect(payload.model).toBe("doubao-seedream-5-0-260128");
      expect(payload.base_url).toBe("https://ark.cn-beijing.volces.com/api/v3");
    });

    it("sends the new api_key and no preserve flag when a key is entered", async () => {
      const saveSpy = vi.fn<(input: MediaConfigInput) => Promise<MediaConfig>>(async () => configFile);
      const { container } = await renderSettings(
        fakeClient({ getMediaConfig: async () => configFile, saveMediaConfig: saveSpy }),
      );

      setInput(inputByName(container, "api_key"), "new-secret-key");

      await act(async () => {
        buttonByTestId(container, "media-save").click();
        await flushPromises();
      });

      const payload = saveSpy.mock.calls[0][0];
      expect(payload.api_key).toBe("new-secret-key");
      expect(payload.preserve_api_key).toBeUndefined();
    });
  });

  describe("test connection", () => {
    it("shows the provider_note on success", async () => {
      const { container } = await renderSettings(
        fakeClient({
          testMediaConnection: async (): Promise<MediaTestResult> => ({ ok: true, provider_note: "ark ok 200" }),
        }),
      );

      await act(async () => {
        buttonByTestId(container, "media-test").click();
        await flushPromises();
      });

      expect(panel(container).textContent).toContain("ark ok 200");
    });

    it("shows the error message on failure", async () => {
      const { container } = await renderSettings(
        fakeClient({
          testMediaConnection: async () => {
            throw new ApiError("MEDIA_PROVIDER_ERROR", "ark rejected the request", {}, 502);
          },
        }),
      );

      await act(async () => {
        buttonByTestId(container, "media-test").click();
        await flushPromises();
      });

      expect(panel(container).textContent).toContain("ark rejected the request");
    });
  });
});
