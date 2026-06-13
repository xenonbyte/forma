import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  formatApiError,
  type ApiErrorInfo,
  type FormaApiClient,
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

  // Form fields. `apiKeyDraft` holds a NEW key the operator typed; it is only
  // ever sent on save, never derived back from the masked read.
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");

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

      const provider = catalogue.providers.find((p) => p.default) ?? catalogue.providers[0];
      const initialProvider = provider?.id ?? "";
      const providerModels = catalogue.models.filter((m) => m.provider === initialProvider);
      const configuredModel =
        config.model && providerModels.some((m) => m.id === config.model) ? config.model : undefined;
      const initialModel = configuredModel ?? providerModels.find((m) => m.default)?.id ?? providerModels[0]?.id ?? "";
      const initialBaseUrl = config.base_url ?? provider?.defaultBaseUrl ?? "";

      setProviderId(initialProvider);
      setModelId(initialModel);
      setBaseUrl(initialBaseUrl);
      setApiKeyDraft("");
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
  const source = config.source;
  const keyFromEnv = source === "env";
  const keyConfigured = config.configured;

  function handleProviderChange(nextProvider: string) {
    setProviderId(nextProvider);
    const nextModels = catalogue.models.filter((m) => m.provider === nextProvider);
    setModelId(nextModels.find((m) => m.default)?.id ?? nextModels[0]?.id ?? "");
    const provider = catalogue.providers.find((p) => p.id === nextProvider);
    setBaseUrl(provider?.defaultBaseUrl ?? "");
  }

  async function handleSave() {
    setSaving(true);
    setSaveFeedback(null);
    try {
      const newKey = apiKeyDraft.trim();
      const input: MediaConfigInput = {
        model: modelId,
        base_url: baseUrl.trim(),
      };
      if (newKey) {
        // Operator entered a fresh key — send it; no preserve flag.
        input.api_key = newKey;
      } else if (keyConfigured) {
        // Editing model/base_url without re-entering the key — keep the stored key.
        input.preserve_api_key = true;
      }

      const next = await client.saveMediaConfig(input);
      setLoad({ status: "ready", catalogue, config: next });
      setApiKeyDraft("");
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
            keyFromEnv ? "" : config.api_key_tail ? `••••${config.api_key_tail}` : t("settings.apiKeyPlaceholder")
          }
          type="password"
          value={apiKeyDraft}
        />
        {keyFromEnv ? (
          <span className="text-xs font-normal text-zinc-500">{t("settings.apiKeyEnv")}</span>
        ) : config.api_key_tail ? (
          <span className="text-xs font-normal text-zinc-500">
            ••••{config.api_key_tail} — {t("settings.apiKeyConfigured")}
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

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm" data-settings-panel="image-model">
      <h2 className="text-sm font-semibold tracking-normal text-zinc-950">{title}</h2>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}
