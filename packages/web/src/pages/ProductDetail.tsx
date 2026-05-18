import { useEffect, useState, type FormEvent } from "react";

import {
  apiClient,
  formatApiError,
  languageOptions,
  type ApiErrorInfo,
  type FormaApiClient,
  type Language,
  type Platform,
  type Product,
  type ProductBaseline,
  type RequirementWithDocument,
  type StyleMetadata
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { PrimaryActionLink, StatePanel, WorkSurface } from "../components/Layout.js";
import { StatusBadge, type ConfigStatus } from "../components/StatusBadge.js";
import { deriveDefaultLanguage } from "./ProductNew.js";

export interface ProductDetailProps {
  client?: Pick<
    FormaApiClient,
    "archiveRequirement" | "configureProduct" | "createEmptyRequirement" | "getBaseline" | "getProduct" | "listRequirements" | "listStyles"
  >;
  hash?: string;
  params: Record<string, string>;
}

export type BaselineSummaryState =
  | { status: "error"; error: ApiErrorInfo }
  | { baseline: ProductBaseline; status: "ready" };

type RequirementListState =
  | { status: "error"; error: ApiErrorInfo }
  | { requirements: RequirementWithDocument[]; status: "ready" };

type ProductDetailState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { baselineState: BaselineSummaryState; product: Product; requirementState: RequirementListState; status: "ready" };

export function ProductDetail({ client = apiClient, hash = "", params }: ProductDetailProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const [actionError, setActionError] = useState<ApiErrorInfo | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<ProductDetailState>({ status: "loading" });
  const [title, setTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getProduct(productId)
      .then(async (product) => {
        const [requirementState, baselineState] = await Promise.all([loadRequirements(client, productId), loadBaseline(client, productId)]);
        if (!cancelled) {
          setState({ baselineState, product, requirementState, status: "ready" });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ error: formatApiError(error), status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, productId, reloadKey]);

  useEffect(() => {
    if (state.status !== "ready" || hash.length === 0 || !canUseDom()) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      focusHashTarget(hash);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [hash, state.status]);

  const canCreateRequirement = title.trim().length > 0 && !creating;

  async function handleCreateRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateRequirement) {
      return;
    }

    setActionError(null);
    setCreating(true);
    try {
      await client.createEmptyRequirement(productId, { title: title.trim() });
      setTitle("");
      setReloadKey((value) => value + 1);
    } catch (error: unknown) {
      setActionError(formatApiError(error));
    } finally {
      setCreating(false);
    }
  }

  function handleProductConfigured(product: Product) {
    setActionError(null);
    setState((current) => (current.status === "ready" ? { ...current, product } : current));
  }

  async function handleArchive(requirementId: string) {
    setArchiving(requirementId);
    setActionError(null);
    try {
      await client.archiveRequirement(productId, requirementId);
      setReloadKey((value) => value + 1);
    } catch (error: unknown) {
      setActionError(formatApiError(error));
    } finally {
      setArchiving(null);
    }
  }

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("product.workspace")}>
        {t("product.workspaceLoading")}
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel action={<PrimaryActionLink href="/products">{t("action.products")}</PrimaryActionLink>} state="error" title={t("product.unavailable")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  return (
    <div className="space-y-5">
      <ProductDetailSummaryPanels
        actionError={actionError}
        baselineState={state.baselineState}
        productId={productId}
        requirementCount={state.requirementState.status === "ready" ? state.requirementState.requirements.length : 0}
        requirementError={state.requirementState.status === "error" ? state.requirementState.error : undefined}
      />

      <WorkSurface title={t("product.configuration")}>
        <div className="grid gap-4 text-sm md:grid-cols-6">
          <Fact label={t("product.id")} value={state.product.id} />
          <Fact label={t("product.platform")} value={state.product.platform ?? t("common.notConfigured")} />
          <Fact label={t("product.style")} value={state.product.style?.name ?? t("common.notConfigured")} />
          <Fact label={t("product.languages")} value={languageSummary(state.product.languages, t)} />
          <Fact label={t("product.defaultLanguage")} value={state.product.default_language ?? t("common.notConfigured")} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("product.configStatus")}</p>
            <div className="mt-2">
              <StatusBadge status={configStatus(state.product)} />
            </div>
          </div>
        </div>
      </WorkSurface>

      {needsProductConfiguration(state.product) ? (
        <ProductConfigurationForm
          client={client}
          onConfigured={handleProductConfigured}
          onError={setActionError}
          product={state.product}
          productId={productId}
        />
      ) : null}

      {state.requirementState.status === "error" ? (
        <StatePanel state="error" title={t("requirement.listUnavailable")}>
          {state.requirementState.error.error_code} - {state.requirementState.error.message}
        </StatePanel>
      ) : state.requirementState.requirements.length === 0 ? (
        <StatePanel state="empty" title={t("requirement.noRequirements")}>
          {t("requirement.noRequirementsHelp")}
        </StatePanel>
      ) : (
        <WorkSurface title={t("requirement.list")}>
          <div className="divide-y divide-zinc-200">
            {state.requirementState.requirements.map((requirement) => (
              <div className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_8rem_9rem_8rem]" key={requirement.id}>
                <div className="min-w-0">
                  <a className={`${textLinkClasses} truncate`} href={`/products/${productId}/requirements/${requirement.id}`}>
                    {requirement.title}
                  </a>
                  <p className="mt-1 font-mono text-xs text-zinc-500">{requirement.id}</p>
                </div>
                <div className="flex items-center">
                  <StatusBadge status={requirement.status} />
                </div>
                <p className="self-center text-sm text-zinc-600">
                  {requirement.pages.length} {requirement.pages.length === 1 ? t("requirement.pageCountSingular") : t("requirement.pageCount")}
                </p>
                <button
                  className={secondaryButtonClasses}
                  disabled={requirement.status !== "active" || archiving === requirement.id}
                  onClick={() => void handleArchive(requirement.id)}
                  type="button"
                >
                  {archiving === requirement.id ? t("action.archiving") : t("action.archive")}
                </button>
              </div>
            ))}
          </div>
        </WorkSurface>
      )}

      <div
        className="scroll-mt-24 rounded-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-amber-500"
        id="new-requirement"
        tabIndex={-1}
      >
        <WorkSurface title={t("requirement.new")}>
          <form className="grid gap-4" onSubmit={handleCreateRequirement}>
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              {t("requirement.title")}
              <input
                className={inputClasses}
                name="requirement_title"
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("requirement.titlePlaceholder")}
                value={title}
              />
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-zinc-500">{canCreateRequirement ? t("requirement.titleReady") : t("requirement.createNeedsTitle")}</p>
              <button className={primaryButtonClasses} disabled={!canCreateRequirement} type="submit">
                {creating ? t("action.creating") : t("action.createRequirement")}
              </button>
            </div>
          </form>
        </WorkSurface>
      </div>
    </div>
  );
}

export function focusHashTarget(
  hash: string,
  root: Pick<Document, "getElementById"> = document
): boolean {
  const id = decodeHashId(hash);
  if (!id) {
    return false;
  }

  const target = root.getElementById(id);
  if (!target) {
    return false;
  }

  target.scrollIntoView({ block: "start" });
  target.focus({ preventScroll: true });
  return true;
}

export function ProductDetailSummaryPanels({
  actionError,
  baselineState,
  productId,
  requirementCount,
  requirementError
}: {
  actionError: ApiErrorInfo | null;
  baselineState: BaselineSummaryState;
  productId: string;
  requirementCount: number;
  requirementError?: ApiErrorInfo;
}) {
  const t = useT();

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <section className={summaryPanelClasses}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("requirement.baseline")}</p>
            {baselineState.status === "ready" ? (
              <p className="mt-2 text-sm font-semibold text-zinc-950">
                {baselineState.baseline.pages.length} {baselineState.baseline.pages.length === 1 ? t("requirement.pageCountSingular") : t("requirement.pageCount")}
              </p>
            ) : (
              <p className="mt-2 text-sm font-semibold text-red-700">{baselineState.error.error_code}</p>
            )}
          </div>
          <PrimaryActionLink href={`/products/${productId}/baseline`}>{t("action.baseline")}</PrimaryActionLink>
        </div>
        {baselineState.status === "ready" ? (
          <p className="mt-2 text-sm text-zinc-600">
            {baselineState.baseline.navigation.length}{" "}
            {baselineState.baseline.navigation.length === 1 ? t("product.baselineEdgeSingular") : t("product.baselineEdges")}.
          </p>
        ) : (
          <p className="mt-2 text-sm text-red-700">{baselineState.error.message}</p>
        )}
      </section>
      <section className={summaryPanelClasses}>
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("requirement.records")}</p>
        {requirementError ? (
          <>
            <p className="mt-2 text-sm font-semibold text-red-700">{requirementError.error_code}</p>
            <p className="mt-1 text-sm text-red-700">{requirementError.message}</p>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm font-semibold text-zinc-950">{requirementCount}</p>
            <p className="mt-1 text-sm text-zinc-600">{t("requirement.loadedForProduct")}</p>
          </>
        )}
      </section>
      {actionError ? (
        <StatePanel state="error" title={t("requirement.actionResult")}>
          {actionError.error_code} - {actionError.message}
        </StatePanel>
      ) : (
        <section className={summaryPanelClasses}>
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("product.archiveGate")}</p>
          <p className="mt-2 text-sm text-zinc-600">{t("product.archiveGateHelp")}</p>
        </section>
      )}
    </div>
  );
}

function ProductConfigurationForm({
  client,
  onConfigured,
  onError,
  product,
  productId
}: {
  client: Pick<FormaApiClient, "configureProduct" | "listStyles">;
  onConfigured: (product: Product) => void;
  onError: (error: ApiErrorInfo | null) => void;
  product: Product;
  productId: string;
}) {
  const t = useT();
  const [defaultLanguage, setDefaultLanguage] = useState<Language | "">(
    deriveDefaultLanguage(product.languages ?? [], product.default_language)
  );
  const [listError, setListError] = useState<ApiErrorInfo | null>(null);
  const [platform, setPlatform] = useState<Platform | "">(product.platform ?? "");
  const [saving, setSaving] = useState(false);
  const [selectedLanguages, setSelectedLanguages] = useState<Language[]>(product.languages ?? []);
  const [submitError, setSubmitError] = useState<ApiErrorInfo | null>(null);
  const [styleName, setStyleName] = useState(product.style?.name ?? "");
  const [styles, setStyles] = useState<StyleMetadata[]>([]);
  const [stylesLoading, setStylesLoading] = useState(true);
  const styleOptions = ensureCurrentStyle(styles, product.style);
  const canSubmit =
    platform !== "" && styleName.length > 0 && selectedLanguages.length > 0 && defaultLanguage !== "" && !listError && !stylesLoading && !saving;

  useEffect(() => {
    let cancelled = false;
    setStylesLoading(true);
    setListError(null);

    client
      .listStyles()
      .then((nextStyles) => {
        if (!cancelled) {
          setStyles(nextStyles);
          setStylesLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const nextError = formatApiError(error);
          setListError(nextError);
          onError(nextError);
          setStyles([]);
          setStyleName("");
          setStylesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, onError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSaving(true);
    setSubmitError(null);
    onError(null);
    try {
      const configured = await client.configureProduct(productId, {
        default_language: defaultLanguage as Language,
        languages: selectedLanguages,
        platform: platform as Platform,
        style: styleName
      });
      onConfigured(configured);
    } catch (error: unknown) {
      const nextError = formatApiError(error);
      setSubmitError(nextError);
      onError(nextError);
    } finally {
      setSaving(false);
    }
  }

  function updateSelectedLanguage(language: Language, checked: boolean) {
    const nextSelected = checked ? [...selectedLanguages, language] : selectedLanguages.filter((selected) => selected !== language);
    setSelectedLanguages(nextSelected);
    setDefaultLanguage(deriveDefaultLanguage(nextSelected, defaultLanguage || undefined));
  }

  return (
    <WorkSurface title={t("product.completeConfiguration")}>
      <form className="grid gap-4" data-product-config-form="true" onSubmit={handleSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            {t("product.platform")}
            <select
              className={`${inputClasses} disabled:cursor-not-allowed disabled:text-zinc-400`}
              name="platform"
              onChange={(event) => setPlatform(event.target.value as Platform | "")}
              value={platform}
            >
              <option value="">{t("product.selectPlatform")}</option>
              {platformOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            {t("product.style")}
            <select
              className={`${inputClasses} disabled:cursor-not-allowed disabled:text-zinc-400`}
              disabled={stylesLoading || !!listError}
              name="style"
              onChange={(event) => setStyleName(event.target.value)}
              value={styleName}
            >
              <option value="">{stylesLoading ? t("product.stylesLoading") : t("product.selectStyle")}</option>
              {styleOptions.map((style) => (
                <option key={style.name} value={style.name}>
                  {style.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-zinc-700">{t("product.languages")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {languageOptions.map((language) => (
              <label
                className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                key={language.value}
              >
                <input
                  checked={selectedLanguages.includes(language.value)}
                  className="h-4 w-4 accent-amber-500"
                  name="languages"
                  onChange={(event) => updateSelectedLanguage(language.value, event.target.checked)}
                  type="checkbox"
                  value={language.value}
                />
                {language.label}
              </label>
            ))}
          </div>
        </fieldset>

        {selectedLanguages.length > 1 ? (
          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            {t("product.defaultLanguage")}
            <select
              className={inputClasses}
              name="default_language"
              onChange={(event) => setDefaultLanguage(event.target.value as Language)}
              value={defaultLanguage}
            >
              {selectedLanguages.map((language) => (
                <option key={language} value={language}>
                  {languageOptions.find((option) => option.value === language)?.label ?? language}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {listError ? <p className="text-sm text-red-700">{listError.error_code} - {listError.message}</p> : null}
        {submitError ? <p className="text-sm text-red-700">{submitError.error_code} - {submitError.message}</p> : null}

        <div className="flex justify-end">
          <button className={primaryButtonClasses} disabled={!canSubmit} type="submit">
            {saving ? t("action.saving") : t("action.saveConfiguration")}
          </button>
        </div>
      </form>
    </WorkSurface>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{label}</p>
      <p className="mt-2 truncate text-sm font-medium text-zinc-900">{value}</p>
    </div>
  );
}

function configStatus(product: Product): ConfigStatus {
  if (!hasProductConfiguration(product)) {
    return "configuration_incomplete";
  }

  if (product.components_initialized) {
    return "initialized";
  }

  return "configured";
}

function needsProductConfiguration(product: Product): boolean {
  return !hasProductConfiguration(product);
}

function hasProductConfiguration(product: Product): boolean {
  return Boolean(
    product.platform &&
      product.style &&
      product.languages &&
      product.languages.length > 0 &&
      product.default_language &&
      product.languages.includes(product.default_language)
  );
}

function languageSummary(languages: Language[] | undefined, t: (key: string) => string): string {
  if (!languages || languages.length === 0) {
    return t("product.languageSummaryEmpty");
  }
  return languages.join(", ");
}

function ensureCurrentStyle(styles: StyleMetadata[], currentStyle: StyleMetadata | undefined): StyleMetadata[] {
  if (!currentStyle || styles.some((style) => style.name === currentStyle.name)) {
    return styles;
  }
  return [currentStyle, ...styles];
}

async function loadBaseline(client: Pick<FormaApiClient, "getBaseline">, productId: string): Promise<BaselineSummaryState> {
  try {
    return { baseline: await client.getBaseline(productId), status: "ready" };
  } catch (error: unknown) {
    return { error: formatApiError(error), status: "error" };
  }
}

async function loadRequirements(client: Pick<FormaApiClient, "listRequirements">, productId: string): Promise<RequirementListState> {
  try {
    return { requirements: await client.listRequirements(productId), status: "ready" };
  } catch (error: unknown) {
    return { error: formatApiError(error), status: "error" };
  }
}

function decodeHashId(hash: string): string {
  if (!hash.startsWith("#") || hash.length === 1) {
    return "";
  }

  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

function canUseDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

const platformOptions: Array<{ label: string; value: Platform }> = [
  { label: "platform.web", value: "web" },
  { label: "platform.mobile", value: "mobile" },
  { label: "platform.desktop", value: "desktop" },
  { label: "platform.tablet", value: "tablet" }
];

const inputClasses =
  "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm transition placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const primaryButtonClasses =
  "inline-flex items-center justify-center rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const secondaryButtonClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const summaryPanelClasses = "rounded-lg border border-zinc-200 bg-white p-4 shadow-sm";
const textLinkClasses =
  "inline-flex rounded-md text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
