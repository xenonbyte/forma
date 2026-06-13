import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  formatApiError,
  type ApiErrorInfo,
  type FormaApiClient,
  type MaskedProviderConfig,
  type MediaCatalogue,
  type MediaConfig,
  type MediaConfigInput,
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { LanguageSwitcher } from "../components/LanguageSwitcher.js";

/** Narrow FormaApiClient slice the Settings image-model section needs. */
export type SettingsClient = Pick<
  FormaApiClient,
  "getMediaCatalogue" | "getMediaConfig" | "saveMediaConfig" | "testMediaConnection"
>;

export interface SettingsProps {
  client: SettingsClient;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: ApiErrorInfo }
  | { status: "ready"; catalogue: MediaCatalogue; config: MediaConfig };

type Feedback = { kind: "success" | "error"; message: string };

const inputClasses =
  "w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm transition placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400";

const primaryButtonClasses =
  "inline-flex items-center justify-center rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

const secondaryButtonClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 active:scale-95 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

const NONE_PROVIDER_CONFIG: MaskedProviderConfig = { configured: false, source: "none" };

export function Settings({ client }: SettingsProps) {
  const t = useT();

  return (
    <div className="grid max-w-xl gap-5">
      <section className="rounded-lg border border-zinc-200 bg-white shadow-sm" data-settings-panel="language">
        <div className="flex min-h-[72px] items-center justify-between gap-4 px-4">
          <h2 className="text-sm font-semibold tracking-normal text-zinc-950">{t("settings.multilingual")}</h2>
          <LanguageSwitcher ariaLabel={t("settings.multilingual")} />
        </div>
      </section>

      <ImageModelSection client={client} />
    </div>
  );
}

function ImageModelSection({ client }: SettingsProps) {
  const t = useT();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });

  // The provider whose config panel is shown. Independent of the active
  // provider — the operator can inspect/edit any provider's credentials.
  const [providerId, setProviderId] = useState("");

  // Per selected-provider form fields. `apiKeyDraft` holds a NEW key the
  // operator typed; it is only ever sent on save, never derived from the masked
  // read. `makeActive` reflects an explicit "set as active provider" choice.
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [makeActive, setMakeActive] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<Feedback | null>(null);
  const [testFeedback, setTestFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });

    async function loadAll() {
      const [catalogue, config] = await Promise.all([client.getMediaCatalogue(), client.getMediaConfig()]);
      if (cancelled) return;

      // Land on the active provider when set, else the catalogue default.
      const active = config.active_provider ?? "";
      const fallback = catalogue.providers.find((p) => p.default) ?? catalogue.providers[0];
      const initialProvider =
        (active && catalogue.providers.some((p) => p.id === active) ? active : fallback?.id) ?? "";

      const fields = providerFormFields(catalogue, config, initialProvider);
      setProviderId(initialProvider);
      setModelId(fields.model);
      setBaseUrl(fields.baseUrl);
      setApiKeyDraft("");
      setMakeActive(false);
      setLoad({ status: "ready", catalogue, config });
    }

    loadAll().catch((error: unknown) => {
      if (!cancelled) {
        setLoad({ status: "error", error: formatApiError(error) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client]);

  const models = useMemo(() => {
    if (load.status !== "ready") return [];
    return load.catalogue.models.filter((m) => m.provider === providerId);
  }, [load, providerId]);

  if (load.status === "loading") {
    return (
      <Panel title={t("settings.imageModel")}>
        <p className="text-sm text-zinc-500">{t("settings.loading")}</p>
      </Panel>
    );
  }

  if (load.status === "error") {
    return (
      <Panel title={t("settings.imageModel")}>
        <p className="text-sm text-rose-600">
          {t("settings.loadFailed")}: {load.error.error_code} — {load.error.message}
        </p>
      </Panel>
    );
  }

  const { catalogue, config } = load;
  const providerConfig = config.providers[providerId] ?? NONE_PROVIDER_CONFIG;
  const source = providerConfig.source;
  const keyFromEnv = source === "env";
  const keyConfigured = providerConfig.configured;
  const activeProvider = config.active_provider;
  const isActive = activeProvider === providerId;
  const activeLabel =
    (activeProvider && catalogue.providers.find((p) => p.id === activeProvider)?.label) ?? activeProvider;

  function handleProviderChange(nextProvider: string) {
    setProviderId(nextProvider);
    const fields = providerFormFields(catalogue, config, nextProvider);
    setModelId(fields.model);
    setBaseUrl(fields.baseUrl);
    setApiKeyDraft("");
    setMakeActive(false);
    setSaveFeedback(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveFeedback(null);
    try {
      const newKey = apiKeyDraft.trim();
      const input: MediaConfigInput = {
        provider: providerId,
        model: modelId,
        base_url: baseUrl.trim(),
      };
      if (newKey) {
        // Operator entered a fresh key for THIS provider — send it; no preserve flag.
        input.api_key = newKey;
      } else if (keyConfigured) {
        // Editing model/base_url without re-entering a key keeps any existing file-stored key.
        input.preserve_api_key = true;
      }
      if (makeActive) {
        input.make_active = true;
      }

      const next = await client.saveMediaConfig(input);
      setLoad({ status: "ready", catalogue, config: next });
      // Re-seed the form from the fresh masked read for the selected provider.
      const fields = providerFormFields(catalogue, next, providerId);
      setModelId(fields.model);
      setBaseUrl(fields.baseUrl);
      setApiKeyDraft("");
      setMakeActive(false);
      setSaveFeedback({ kind: "success", message: t("settings.saved") });
    } catch (error: unknown) {
      const info = formatApiError(error);
      setSaveFeedback({ kind: "error", message: `${t("settings.saveFailed")}: ${info.message}` });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestFeedback(null);
    try {
      const result = await client.testMediaConnection();
      const note = result.provider_note ? `: ${result.provider_note}` : "";
      setTestFeedback({ kind: "success", message: `${t("settings.testSuccess")}${note}` });
    } catch (error: unknown) {
      const info = formatApiError(error);
      setTestFeedback({ kind: "error", message: `${t("settings.testFailed")}: ${info.message}` });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Panel title={t("settings.imageModel")}>
      <p className="text-sm text-zinc-500">{t("settings.imageModelHelp")}</p>

      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700" data-testid="active-provider">
        <span className="font-medium">{t("settings.activeProvider")}:</span>
        {activeLabel ? (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            {activeLabel}
          </span>
        ) : (
          <span className="text-zinc-500">{t("settings.activeProviderNone")}</span>
        )}
      </div>

      <label className="grid gap-1 text-sm font-medium text-zinc-700">
        {t("settings.provider")}
        <select
          className={inputClasses}
          name="provider"
          onChange={(event) => handleProviderChange(event.target.value)}
          value={providerId}
        >
          {catalogue.providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm font-medium text-zinc-700">
        {t("settings.model")}
        <select
          className={inputClasses}
          name="model"
          onChange={(event) => setModelId(event.target.value)}
          value={modelId}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm font-medium text-zinc-700">
        {t("settings.apiKey")}
        <input
          autoComplete="off"
          className={inputClasses}
          disabled={keyFromEnv}
          name="api_key"
          onChange={(event) => setApiKeyDraft(event.target.value)}
          placeholder={
            keyFromEnv
              ? ""
              : providerConfig.api_key_tail
                ? `••••${providerConfig.api_key_tail}`
                : t("settings.apiKeyPlaceholder")
          }
          type="password"
          value={apiKeyDraft}
        />
        {keyFromEnv ? (
          <span className="text-xs font-normal text-zinc-500">{t("settings.apiKeyEnv")}</span>
        ) : providerConfig.api_key_tail ? (
          <span className="text-xs font-normal text-zinc-500">
            ••••{providerConfig.api_key_tail} — {t("settings.apiKeyConfigured")}
          </span>
        ) : null}
      </label>

      <label className="grid gap-1 text-sm font-medium text-zinc-700">
        {t("settings.baseUrl")}
        <input
          className={inputClasses}
          name="base_url"
          onChange={(event) => setBaseUrl(event.target.value)}
          type="text"
          value={baseUrl}
        />
      </label>

      {isActive ? (
        <p className="text-xs font-normal text-emerald-700" data-testid="provider-is-active">
          {t("settings.providerIsActive")}
        </p>
      ) : (
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <input
            checked={makeActive}
            className="h-4 w-4 rounded border-zinc-300 text-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            name="make_active"
            onChange={(event) => setMakeActive(event.target.checked)}
            type="checkbox"
          />
          {t("settings.setActive")}
        </label>
      )}

      <p className="text-xs font-normal text-zinc-500">{t("settings.testUsesActive")}</p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className={primaryButtonClasses}
          data-testid="media-save"
          disabled={saving}
          onClick={() => void handleSave()}
          type="button"
        >
          {saving ? t("settings.saving") : t("settings.save")}
        </button>
        <button
          className={secondaryButtonClasses}
          data-testid="media-test"
          disabled={testing}
          onClick={() => void handleTest()}
          type="button"
        >
          {testing ? t("settings.testing") : t("settings.testConnection")}
        </button>
      </div>

      {saveFeedback ? (
        <p className={`text-sm ${saveFeedback.kind === "success" ? "text-emerald-600" : "text-rose-600"}`}>
          {saveFeedback.message}
        </p>
      ) : null}
      {testFeedback ? (
        <p className={`text-sm ${testFeedback.kind === "success" ? "text-emerald-600" : "text-rose-600"}`}>
          {testFeedback.message}
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * Derive the model + base_url form fields for a provider from the catalogue and
 * masked config. Guards against an orphaned config model id (removed from the
 * catalogue) by falling back to the provider's default model.
 */
function providerFormFields(
  catalogue: MediaCatalogue,
  config: MediaConfig,
  providerId: string,
): { model: string; baseUrl: string } {
  const providerModels = catalogue.models.filter((m) => m.provider === providerId);
  const providerConfig = config.providers[providerId];
  const configuredModel =
    providerConfig?.model && providerModels.some((m) => m.id === providerConfig.model)
      ? providerConfig.model
      : undefined;
  const model = configuredModel ?? providerModels.find((m) => m.default)?.id ?? providerModels[0]?.id ?? "";
  const provider = catalogue.providers.find((p) => p.id === providerId);
  const baseUrl = providerConfig?.base_url ?? provider?.defaultBaseUrl ?? "";
  return { model, baseUrl };
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm" data-settings-panel="image-model">
      <h2 className="text-sm font-semibold tracking-normal text-zinc-950">{title}</h2>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}
