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
      default: true,
    },
    {
      id: "openai",
      label: "OpenAI",
      hint: "OpenAI Images",
      defaultBaseUrl: "https://api.openai.com/v1",
      docsUrl: "https://platform.openai.com/docs",
    },
    {
      id: "gemini",
      label: "Google Gemini",
      hint: "Gemini image",
      defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      docsUrl: "https://ai.google.dev/",
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
    { id: "gpt-image-1", label: "GPT Image 1", hint: "openai", provider: "openai", default: true },
    { id: "imagen-3", label: "Imagen 3", hint: "gemini", provider: "gemini", default: true },
  ],
};

/** No provider configured at all (active null, empty providers map). */
const configNone: MediaConfig = { active_provider: null, providers: {} };

/** volcengine configured from a file key + active. */
const configFile: MediaConfig = {
  active_provider: "volcengine",
  providers: {
    volcengine: {
      configured: true,
      source: "file",
      model: "doubao-seedream-5-0-lite-260128",
      base_url: "https://ark.cn-beijing.volces.com/api/v3",
      api_key_tail: "wxyz",
    },
  },
};

/** volcengine configured from an env key + active. */
const configEnv: MediaConfig = {
  active_provider: "volcengine",
  providers: {
    volcengine: {
      configured: true,
      source: "env",
      model: "doubao-seedream-5-0-260128",
      base_url: "https://ark.cn-beijing.volces.com/api/v3",
    },
  },
};

/**
 * Mixed multi-provider config: volcengine env-sourced + active, openai
 * file-sourced (not active), gemini unconfigured.
 */
const configMulti: MediaConfig = {
  active_provider: "volcengine",
  providers: {
    volcengine: {
      configured: true,
      source: "env",
      model: "doubao-seedream-5-0-260128",
      base_url: "https://ark.cn-beijing.volces.com/api/v3",
    },
    openai: {
      configured: true,
      source: "file",
      model: "gpt-image-1",
      base_url: "https://api.openai.com/v1",
      api_key_tail: "5678",
    },
  },
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

/** Toggle a controlled checkbox the way React expects in happy-dom. */
function setCheckbox(input: HTMLInputElement, checked: boolean) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
  setter?.call(input, checked);
  input.dispatchEvent(new Event("click", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function activeIndicator(container: HTMLElement): string {
  const el = panel(container).querySelector<HTMLElement>("[data-testid='active-provider']");
  if (!el) throw new Error("missing active-provider indicator");
  return el.textContent ?? "";
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
  it("lists all visible providers and preselects the default provider + model", async () => {
    const { container } = await renderSettings(fakeClient());

    expect(panel(container)).not.toBeNull();

    const provider = selectByName(container, "provider");
    expect([...provider.options].map((o) => o.value)).toEqual(["volcengine", "openai", "gemini"]);
    // Default-flagged provider (volcengine) is preselected when nothing is active.
    expect(provider.value).toBe("volcengine");

    const model = selectByName(container, "model");
    // Only the selected provider's models appear; the default-flagged one is preselected.
    expect([...model.options].map((o) => o.value)).toEqual([
      "doubao-seedream-5-0-260128",
      "doubao-seedream-5-0-lite-260128",
    ]);
    expect(model.value).toBe("doubao-seedream-5-0-260128");
  });

  it("lands on the active provider's panel when active_provider is set", async () => {
    const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configMulti }));
    expect(selectByName(container, "provider").value).toBe("volcengine");
  });

  it("switching provider shows that provider's filtered model list and config panel", async () => {
    const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configMulti }));

    setSelect(selectByName(container, "provider"), "openai");
    await act(async () => {
      await flushPromises();
    });

    // openai's models only — volcengine + gemini models must not appear.
    const model = selectByName(container, "model");
    expect([...model.options].map((o) => o.value)).toEqual(["gpt-image-1"]);
    expect([...model.options].map((o) => o.value)).not.toContain("doubao-seedream-5-0-260128");
    expect([...model.options].map((o) => o.value)).not.toContain("imagen-3");
    // openai is file-sourced in configMulti → masked tail shown, editable.
    expect(inputByName(container, "api_key").disabled).toBe(false);
    expect(panel(container).textContent).toContain("••••5678");
  });

  it("filters models to the selected provider", async () => {
    const { container } = await renderSettings(fakeClient());
    const model = selectByName(container, "model");
    // gemini/openai models belong to other providers and must not appear under volcengine.
    expect([...model.options].map((o) => o.value)).not.toContain("imagen-3");
    expect([...model.options].map((o) => o.value)).not.toContain("gpt-image-1");
  });

  it("preselects the configured model from GET config", async () => {
    const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configFile }));
    expect(selectByName(container, "model").value).toBe("doubao-seedream-5-0-lite-260128");
  });

  it("falls back to the catalogue default when config.model is not in the provider's model list", async () => {
    const orphanConfig: MediaConfig = {
      active_provider: "volcengine",
      providers: {
        volcengine: { ...configFile.providers.volcengine, model: "removed-old-model-id" },
      },
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
    expect(saveSpy.mock.calls[0][0].provider).toBe("volcengine");
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

  describe("masked key display (per selected provider)", () => {
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

    it("reflects each provider's own source when switching providers", async () => {
      // volcengine env (active), openai file, gemini none.
      const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configMulti }));

      // volcengine — env-sourced: disabled, env note.
      expect(inputByName(container, "api_key").disabled).toBe(true);
      expect(panel(container).textContent?.toLowerCase()).toMatch(/environment|环境变量/);

      // Switch to openai — file-sourced: editable, masked tail.
      setSelect(selectByName(container, "provider"), "openai");
      await act(async () => {
        await flushPromises();
      });
      expect(inputByName(container, "api_key").disabled).toBe(false);
      expect(panel(container).textContent).toContain("••••5678");

      // Switch to gemini — unconfigured: editable, empty.
      setSelect(selectByName(container, "provider"), "gemini");
      await act(async () => {
        await flushPromises();
      });
      const geminiKey = inputByName(container, "api_key");
      expect(geminiKey.disabled).toBe(false);
      expect(geminiKey.value).toBe("");
    });
  });

  describe("save payload", () => {
    it("sends provider + preserve_api_key when model changes but no new key is entered", async () => {
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
      expect(payload.provider).toBe("volcengine");
      expect(payload.preserve_api_key).toBe(true);
      expect(payload.api_key).toBeUndefined();
      expect(payload.model).toBe("doubao-seedream-5-0-260128");
      expect(payload.base_url).toBe("https://ark.cn-beijing.volces.com/api/v3");
      // Already active → no make_active.
      expect(payload.make_active).toBeUndefined();
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

    it("selecting a new provider + typing a key + set-active sends provider/api_key/make_active and NO preserve", async () => {
      const saveSpy = vi.fn<(input: MediaConfigInput) => Promise<MediaConfig>>(async () => configMulti);
      const { container } = await renderSettings(
        fakeClient({ getMediaConfig: async () => configNone, saveMediaConfig: saveSpy }),
      );

      // Switch to openai (unconfigured, not active), type a key, check set-active.
      setSelect(selectByName(container, "provider"), "openai");
      await act(async () => {
        await flushPromises();
      });
      setInput(inputByName(container, "api_key"), "openai-key");
      setCheckbox(inputByName(container, "make_active"), true);

      await act(async () => {
        buttonByTestId(container, "media-save").click();
        await flushPromises();
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const payload = saveSpy.mock.calls[0][0];
      expect(payload.provider).toBe("openai");
      expect(payload.api_key).toBe("openai-key");
      expect(payload.make_active).toBe(true);
      expect(payload.preserve_api_key).toBeUndefined();
      expect(payload.model).toBe("gpt-image-1");
    });

    it("env-source provider never sends a key or preserve flag (managed outside the app)", async () => {
      const saveSpy = vi.fn<(input: MediaConfigInput) => Promise<MediaConfig>>(async () => configEnv);
      const { container } = await renderSettings(
        fakeClient({ getMediaConfig: async () => configEnv, saveMediaConfig: saveSpy }),
      );

      setSelect(selectByName(container, "model"), "doubao-seedream-5-0-lite-260128");

      await act(async () => {
        buttonByTestId(container, "media-save").click();
        await flushPromises();
      });

      const payload = saveSpy.mock.calls[0][0];
      expect(payload.provider).toBe("volcengine");
      expect(payload.api_key).toBeUndefined();
      expect(payload.preserve_api_key).toBeUndefined();
      expect(payload.model).toBe("doubao-seedream-5-0-lite-260128");
    });
  });

  describe("active provider indicator", () => {
    it("reflects active_provider with the provider label", async () => {
      const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configMulti }));
      expect(activeIndicator(container)).toContain("火山方舟 (Volcengine Ark)");
    });

    it("shows a no-active state when active_provider is null", async () => {
      const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configNone }));
      expect(activeIndicator(container).toLowerCase()).toMatch(/none|无/);
    });

    it("hides set-active and shows an active note when the selected provider is active", async () => {
      const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configFile }));
      expect(panel(container).querySelector("input[name='make_active']")).toBeNull();
      expect(panel(container).querySelector("[data-testid='provider-is-active']")).not.toBeNull();
    });

    it("shows the set-active checkbox for a non-active selected provider", async () => {
      const { container } = await renderSettings(fakeClient({ getMediaConfig: async () => configMulti }));
      setSelect(selectByName(container, "provider"), "openai");
      await act(async () => {
        await flushPromises();
      });
      expect(panel(container).querySelector("input[name='make_active']")).not.toBeNull();
      expect(panel(container).querySelector("[data-testid='provider-is-active']")).toBeNull();
    });

    it("updates the active indicator after saving with set-active", async () => {
      // Save openai as active; the returned config flips active_provider to openai.
      const activatedConfig: MediaConfig = {
        active_provider: "openai",
        providers: {
          ...configMulti.providers,
          openai: { ...configMulti.providers.openai, configured: true },
        },
      };
      const saveSpy = vi.fn<(input: MediaConfigInput) => Promise<MediaConfig>>(async () => activatedConfig);
      const { container } = await renderSettings(
        fakeClient({ getMediaConfig: async () => configMulti, saveMediaConfig: saveSpy }),
      );

      setSelect(selectByName(container, "provider"), "openai");
      await act(async () => {
        await flushPromises();
      });
      setCheckbox(inputByName(container, "make_active"), true);

      await act(async () => {
        buttonByTestId(container, "media-save").click();
        await flushPromises();
      });

      expect(activeIndicator(container)).toContain("OpenAI");
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
