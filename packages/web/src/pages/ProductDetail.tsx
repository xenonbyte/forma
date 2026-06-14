import { useEffect, useState, type FormEvent } from "react";

import {
  apiClient,
  formatApiError,
  languageOptions,
  type ApiErrorInfo,
  type ArchiveRequirementResult,
  type BrandAssetsSettings,
  type DeleteProductResult,
  type FormaApiClient,
  type Language,
  type Platform,
  type Product,
  type ProductBaseline,
  type RequirementWithDocument,
  type StyleMetadata,
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { ConfirmDeleteDialog } from "../components/ConfirmDeleteDialog.js";
import { PrimaryActionLink, StatePanel, WorkSurface } from "../components/Layout.js";
import { SkeletonDetail } from "../components/Skeleton.js";
import { StatusBadge, type ConfigStatus } from "../components/StatusBadge.js";
import { deriveDefaultLanguage } from "./ProductNew.js";

export interface ProductDetailProps {
  client?: Pick<
    FormaApiClient,
    | "archiveRequirement"
    | "configureProduct"
    | "createEmptyRequirement"
    | "deleteProduct"
    | "getBaseline"
    | "getProduct"
    | "listRequirements"
    | "listStyles"
    | "updateBrandAssetSettings"
  >;
  hash?: string;
  onBreadcrumbLabel?: (key: string, label: string) => void;
  onNavigate?: (path: string, state?: ProductDeleteNavigationState) => void;
  params: Record<string, string>;
}

export interface ProductDeleteNavigationState {
  cleanupPending: boolean;
  productId: string;
  recoveryWarnings: string[];
  sessionCleared: boolean;
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

export function ProductDetail({
  client = apiClient,
  hash = "",
  onBreadcrumbLabel,
  onNavigate,
  params,
}: ProductDetailProps) {
  const t = useT();
  const productId = params.productId ?? "";
  const [actionError, setActionError] = useState<ApiErrorInfo | null>(null);
  const [archiveResult, setArchiveResult] = useState<ArchiveRequirementResult | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteError, setDeleteError] = useState<ApiErrorInfo | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<ProductDetailState>({ status: "loading" });
  const [title, setTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getProduct(productId)
      .then(async (product) => {
        const [requirementState, baselineState] = await Promise.all([
          loadRequirements(client, productId),
          loadBaseline(client, productId),
        ]);
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

  useEffect(() => {
    if (state.status === "ready") {
      onBreadcrumbLabel?.(`product:${productId}`, state.product.name || productId);
    }
  }, [onBreadcrumbLabel, productId, state]);

  const canCreateRequirement = title.trim().length > 0 && !creating;

  async function handleCreateRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateRequirement) {
      return;
    }

    setActionError(null);
    setArchiveResult(null);
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
    setArchiveResult(null);
    setState((current) => (current.status === "ready" ? { ...current, product } : current));
  }

  async function handleArchive(requirementId: string) {
    setArchiving(requirementId);
    setActionError(null);
    setArchiveResult(null);
    try {
      const result = await client.archiveRequirement(productId, requirementId);
      setArchiveResult(result);
      setReloadKey((value) => value + 1);
    } catch (error: unknown) {
      setActionError(formatApiError(error));
    } finally {
      setArchiving(null);
    }
  }

  async function handleDelete(confirmProductId: string) {
    setDeleting(true);
    setDeleteError(null);
    setActionError(null);
    try {
      const result = await client.deleteProduct(productId, { confirm_product_id: confirmProductId });
      navigateAfterDelete("/products", toDeleteNavigationState(result));
    } catch (error: unknown) {
      const nextError = formatApiError(error);
      setDeleteError(nextError);
      setActionError(nextError);
    } finally {
      setDeleting(false);
    }
  }

  function navigateAfterDelete(path: string, deleteState: ProductDeleteNavigationState) {
    if (onNavigate) {
      onNavigate(path, deleteState);
      return;
    }

    if (typeof window !== "undefined") {
      window.location.assign(path);
    }
  }

  if (state.status === "loading") {
    return (
      <StatePanel state="loading" title={t("product.workspace")}>
        <SkeletonDetail />
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel state="error" title={t("product.unavailable")}>
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  return (
    <div className="space-y-5">
      <ProductDetailSummaryPanels
        actionError={actionError}
        archiveResult={archiveResult}
        baselineState={state.baselineState}
        productId={productId}
        requirementCount={state.requirementState.status === "ready" ? state.requirementState.requirements.length : 0}
        requirementError={state.requirementState.status === "error" ? state.requirementState.error : undefined}
      />

      <WorkSurface title={t("product.configuration")}>
        <div className="grid gap-4 text-sm md:grid-cols-6">
          <Fact label={t("product.id")} value={state.product.id} />
          <Fact label={t("product.platform")} value={state.product.platform ?? t("common.notConfigured")} />
          <Fact label={t("product.style")} value={state.product.brand_style ?? t("common.notConfigured")} />
          <Fact label={t("product.languages")} value={languageSummary(state.product.languages, t)} />
          <Fact
            label={t("product.defaultLanguage")}
            value={state.product.default_language ?? t("common.notConfigured")}
          />
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
        <StatePanel
          action={<PrimaryActionLink href="#new-requirement">{t("action.createRequirement")}</PrimaryActionLink>}
          state="empty"
          title={t("requirement.noRequirements")}
        >
          <div className="flex items-center gap-3">
            <EmptyRequirementsIllustration label={t("requirement.emptyIllustration")} />
            <p>{t("requirement.noRequirementsHelp")}</p>
          </div>
        </StatePanel>
      ) : (
        <WorkSurface title={t("requirement.list")}>
          <div className="divide-y divide-zinc-200">
            {state.requirementState.requirements.map((requirement) => (
              <div className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_8rem_9rem_8rem_8rem]" key={requirement.id}>
                <div className="min-w-0">
                  <a
                    className={`${textLinkClasses} truncate`}
                    href={`/products/${productId}/requirements/${requirement.id}`}
                  >
                    {requirement.title}
                  </a>
                  <p className="mt-1 font-mono text-xs text-zinc-500">{requirement.id}</p>
                </div>
                <div className="flex items-center">
                  <StatusBadge status={requirement.status} />
                </div>
                <p className="self-center text-sm text-zinc-600">
                  {requirement.pages.length}{" "}
                  {requirement.pages.length === 1 ? t("requirement.pageCountSingular") : t("requirement.pageCount")}
                </p>
                <button
                  className={secondaryButtonClasses}
                  disabled={requirement.status !== "active" || archiving === requirement.id}
                  onClick={() => void handleArchive(requirement.id)}
                  type="button"
                >
                  {archiving === requirement.id ? t("action.archiving") : t("action.archive")}
                </button>
                {requirement.status === "archived" ? (
                  <a
                    className={`${secondaryButtonClasses} text-center`}
                    href={`/products/${productId}/requirements/${requirement.id}/annotation`}
                  >
                    {t("action.annotate")}
                  </a>
                ) : (
                  <span aria-hidden="true" />
                )}
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
              <p className="text-sm text-zinc-500">
                {canCreateRequirement ? t("requirement.titleReady") : t("requirement.createNeedsTitle")}
              </p>
              <button className={primaryButtonClasses} disabled={!canCreateRequirement} type="submit">
                {creating ? t("action.creating") : t("action.createRequirement")}
              </button>
            </div>
          </form>
        </WorkSurface>
      </div>

      <BrandAssetSettingsForm
        client={client}
        onProductUpdated={(product) =>
          setState((current) => (current.status === "ready" ? { ...current, product } : current))
        }
        product={state.product}
        productId={productId}
      />

      <WorkSurface title={t("product.dangerZone")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-zinc-600">{t("product.dangerZoneHelp")}</p>
          <button
            className={dangerButtonClasses}
            data-product-detail-delete="true"
            onClick={() => setDeleteOpen(true)}
            type="button"
          >
            {t("action.deleteProduct")}
          </button>
        </div>
        {deleteError ? (
          <p className="mt-3 text-sm text-red-700">
            {deleteError.error_code} - {deleteError.message}
          </p>
        ) : null}
      </WorkSurface>

      <ConfirmDeleteDialog
        busy={deleting}
        error={deleteError}
        onCancel={() => {
          if (!deleting) {
            setDeleteOpen(false);
            setDeleteError(null);
          }
        }}
        onConfirm={(nextProductId) => void handleDelete(nextProductId)}
        open={deleteOpen}
        product={{ id: state.product.id, name: state.product.name }}
      />
    </div>
  );
}

function toDeleteNavigationState(result: DeleteProductResult): ProductDeleteNavigationState {
  return {
    cleanupPending: result.cleanup_pending,
    productId: result.product_id,
    recoveryWarnings: result.recovery_warnings,
    sessionCleared: result.session_cleared,
  };
}

function EmptyRequirementsIllustration({ label }: { label: string }) {
  return (
    <svg
      aria-label={label}
      className="h-14 w-14 shrink-0 text-amber-600"
      data-empty-illustration="requirements"
      fill="none"
      role="img"
      viewBox="0 0 56 56"
    >
      <rect className="text-amber-50" fill="currentColor" height="44" rx="10" width="44" x="6" y="6" />
      <path d="M18 18h16M18 27h20M18 36h12" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
      <path d="M38 34l4 4 7-8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      <path d="M14 12h24l6 6v26H14z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
      <path d="M38 12v7h6" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

export function focusHashTarget(hash: string, root: Pick<Document, "getElementById"> = document): boolean {
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
  archiveResult,
  baselineState,
  productId,
  requirementCount,
  requirementError,
}: {
  actionError: ApiErrorInfo | null;
  archiveResult?: ArchiveRequirementResult | null;
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
                {baselineState.baseline.pages.length}{" "}
                {baselineState.baseline.pages.length === 1
                  ? t("requirement.pageCountSingular")
                  : t("requirement.pageCount")}
              </p>
            ) : (
              <p className="mt-2 text-sm font-semibold text-red-700">{baselineState.error.error_code}</p>
            )}
          </div>
          <PrimaryActionLink href={`/products/${productId}/baseline`}>{t("action.baseline")}</PrimaryActionLink>
          <PrimaryActionLink href={`/products/${productId}/brand`}>{t("action.brandResources")}</PrimaryActionLink>
          <PrimaryActionLink href={`/products/${productId}/brand-assets`}>{t("action.brandAssets")}</PrimaryActionLink>
        </div>
        {baselineState.status === "ready" ? (
          <p className="mt-2 text-sm text-zinc-600">
            {baselineState.baseline.navigation.length}{" "}
            {baselineState.baseline.navigation.length === 1
              ? t("product.baselineEdgeSingular")
              : t("product.baselineEdges")}
            .
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
      ) : archiveResult ? (
        <section className={summaryPanelClasses} data-archive-result="">
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{t("product.archiveResult")}</p>
          <p className="mt-2 text-sm text-zinc-950">
            {t("product.archiveAssetSummary")
              .replace("{totalIcons}", String(archiveResult.icons.totalIcons))
              .replace("{pageCount}", String(archiveResult.icons.pages.length))
              .replace("{totalElements}", String(archiveResult.vzi.totalElements))}
          </p>
        </section>
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
  productId,
}: {
  client: Pick<FormaApiClient, "configureProduct" | "listStyles">;
  onConfigured: (product: Product) => void;
  onError: (error: ApiErrorInfo | null) => void;
  product: Product;
  productId: string;
}) {
  const t = useT();
  const [defaultLanguage, setDefaultLanguage] = useState<Language | "">(
    deriveDefaultLanguage(product.languages ?? [], product.default_language),
  );
  const [listError, setListError] = useState<ApiErrorInfo | null>(null);
  const [platform, setPlatform] = useState<Platform | "">(product.platform ?? "");
  const [saving, setSaving] = useState(false);
  const [selectedLanguages, setSelectedLanguages] = useState<Language[]>(product.languages ?? []);
  const [submitError, setSubmitError] = useState<ApiErrorInfo | null>(null);
  const [styleName, setStyleName] = useState(product.brand_style ?? "");
  const [styles, setStyles] = useState<StyleMetadata[]>([]);
  const [stylesLoading, setStylesLoading] = useState(true);
  const styleOptions = ensureCurrentStyleByName(styles, product.brand_style);
  const canSubmit =
    platform !== "" &&
    styleName.length > 0 &&
    selectedLanguages.length > 0 &&
    defaultLanguage !== "" &&
    !listError &&
    !stylesLoading &&
    !saving;

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
        brand_style: styleName,
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
    const nextSelected = checked
      ? [...selectedLanguages, language]
      : selectedLanguages.filter((selected) => selected !== language);
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

        {listError ? (
          <p className="text-sm text-red-700">
            {listError.error_code} - {listError.message}
          </p>
        ) : null}
        {submitError ? (
          <p className="text-sm text-red-700">
            {submitError.error_code} - {submitError.message}
          </p>
        ) : null}

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

  return "configured";
}

function needsProductConfiguration(product: Product): boolean {
  return !hasProductConfiguration(product);
}

function hasProductConfiguration(product: Product): boolean {
  return Boolean(
    product.platform &&
      product.brand_style &&
      product.languages &&
      product.languages.length > 0 &&
      product.default_language &&
      product.languages.includes(product.default_language),
  );
}

function languageSummary(languages: Language[] | undefined, t: (key: string) => string): string {
  if (!languages || languages.length === 0) {
    return t("product.languageSummaryEmpty");
  }
  return languages.join(", ");
}

function ensureCurrentStyleByName(styles: StyleMetadata[], currentStyleName: string | undefined): StyleMetadata[] {
  if (!currentStyleName || styles.some((style) => style.name === currentStyleName)) {
    return styles;
  }
  // Current style name not in list — add a minimal placeholder so the select doesn't show blank
  return [
    { name: currentStyleName, description: "", design_md_path: "", tokens_css_path: "", components_html_path: "" },
    ...styles,
  ];
}

async function loadBaseline(
  client: Pick<FormaApiClient, "getBaseline">,
  productId: string,
): Promise<BaselineSummaryState> {
  try {
    return { baseline: await client.getBaseline(productId), status: "ready" };
  } catch (error: unknown) {
    return { error: formatApiError(error), status: "error" };
  }
}

async function loadRequirements(
  client: Pick<FormaApiClient, "listRequirements">,
  productId: string,
): Promise<RequirementListState> {
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
  { label: "platform.tablet", value: "tablet" },
];

const inputClasses =
  "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm transition placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const primaryButtonClasses =
  "inline-flex items-center justify-center rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const secondaryButtonClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const dangerButtonClasses =
  "inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 hover:text-red-800 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500";
const summaryPanelClasses = "rounded-lg border border-zinc-200 bg-white p-4 shadow-sm";
const textLinkClasses =
  "inline-flex rounded-md text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

const BRAND_ASSETS_SETTINGS_DEFAULTS: BrandAssetsSettings = {
  store_shot_count: 3,
  banner: false,
  poster_portrait: true,
  poster_landscape: true,
  poster_square: true,
};

const STORE_SHOT_COUNT_OPTIONS = [3, 4, 5, 6, 7, 8] as const;

function BrandAssetSettingsForm({
  client,
  onProductUpdated,
  product,
  productId,
}: {
  client: Pick<FormaApiClient, "updateBrandAssetSettings">;
  onProductUpdated: (product: Product) => void;
  product: Product;
  productId: string;
}) {
  const t = useT();
  const current = product.brand_assets ?? BRAND_ASSETS_SETTINGS_DEFAULTS;
  const [storeShotCount, setStoreShotCount] = useState(current.store_shot_count);
  const [banner, setBanner] = useState(current.banner);
  const [posterPortrait, setPosterPortrait] = useState(current.poster_portrait);
  const [posterLandscape, setPosterLandscape] = useState(current.poster_landscape);
  const [posterSquare, setPosterSquare] = useState(current.poster_square);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiErrorInfo | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      setSaved(false);
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [saved]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await client.updateBrandAssetSettings(productId, {
        store_shot_count: storeShotCount,
        banner,
        poster_portrait: posterPortrait,
        poster_landscape: posterLandscape,
        poster_square: posterSquare,
      });
      onProductUpdated(updated);
      setSaved(true);
    } catch (error: unknown) {
      setSaveError(formatApiError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <WorkSurface title={t("brandAssets.settings")}>
      <form className="grid gap-4" data-brand-asset-settings-form="true" onSubmit={handleSubmit}>
        <label className="grid gap-1 text-sm font-medium text-zinc-700">
          {t("brandAssets.settings.storeShotCount")}
          <select
            className={inputClasses}
            name="store_shot_count"
            onChange={(event) => setStoreShotCount(Number(event.target.value))}
            value={storeShotCount}
          >
            {STORE_SHOT_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-zinc-700">{t("brandAssets.settings.legend")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
              <input
                checked={banner}
                className="h-4 w-4 accent-amber-500"
                name="banner"
                onChange={(event) => setBanner(event.target.checked)}
                type="checkbox"
              />
              {t("brandAssets.settings.banner")}
            </label>
            <label className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
              <input
                checked={posterPortrait}
                className="h-4 w-4 accent-amber-500"
                name="poster_portrait"
                onChange={(event) => setPosterPortrait(event.target.checked)}
                type="checkbox"
              />
              {t("brandAssets.settings.posterPortrait")}
            </label>
            <label className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
              <input
                checked={posterLandscape}
                className="h-4 w-4 accent-amber-500"
                name="poster_landscape"
                onChange={(event) => setPosterLandscape(event.target.checked)}
                type="checkbox"
              />
              {t("brandAssets.settings.posterLandscape")}
            </label>
            <label className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
              <input
                checked={posterSquare}
                className="h-4 w-4 accent-amber-500"
                name="poster_square"
                onChange={(event) => setPosterSquare(event.target.checked)}
                type="checkbox"
              />
              {t("brandAssets.settings.posterSquare")}
            </label>
          </div>
        </fieldset>

        {saveError ? (
          <p className="text-sm text-red-700">
            {saveError.error_code} - {saveError.message}
          </p>
        ) : null}
        {saved && !saveError ? <p className="text-sm text-green-700">{t("brandAssets.settings.saved")}</p> : null}

        <div className="flex justify-end">
          <button className={primaryButtonClasses} disabled={saving} type="submit">
            {saving ? t("brandAssets.settings.saving") : t("brandAssets.settings.save")}
          </button>
        </div>
      </form>
    </WorkSurface>
  );
}
