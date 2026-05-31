import { useEffect, useState, type FormEvent } from "react";

import {
  apiClient,
  formatApiError,
  languageOptions,
  type ApiErrorInfo,
  type FormaApiClient,
  type Language,
  type Platform,
  type StyleMetadata,
  type SystemStyleMetadata
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { StatePanel, WorkSurface } from "../components/Layout.js";
import { StylePickerDialog } from "../components/StylePickerDialog.js";

export interface ProductNewProps {
  client?: Pick<FormaApiClient, "configureProduct" | "createProduct" | "getStyle" | "listStyles" | "listSystemStyles">;
  navigate?: (pathname: string) => void;
}

const platformOptions: Array<{ label: string; value: Platform }> = [
  { label: "platform.web", value: "web" },
  { label: "platform.mobile", value: "mobile" },
  { label: "platform.desktop", value: "desktop" },
  { label: "platform.tablet", value: "tablet" }
];

export function deriveDefaultLanguage(selected: Language[], current?: Language): Language | "" {
  if (selected.length === 0) return "";
  if (current && selected.includes(current)) return current;
  return selected.includes("en") ? "en" : selected[0]!;
}

export function ProductNew({ client = apiClient, navigate = browserNavigate }: ProductNewProps) {
  const t = useT();

  const [description, setDescription] = useState("");
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [createdProductId, setCreatedProductId] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState<Language | "">("");
  const [platform, setPlatform] = useState<Platform | "">("");
  const [selectedLanguages, setSelectedLanguages] = useState<Language[]>([]);
  const [styleName, setStyleName] = useState("");
  const [systemStyleName, setSystemStyleName] = useState("");
  const [styleError, setStyleError] = useState<ApiErrorInfo | null>(null);
  const [styles, setStyles] = useState<StyleMetadata[]>([]);
  const [systemStyles, setSystemStyles] = useState<SystemStyleMetadata[]>([]);
  const [stylesLoading, setStylesLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const canSubmit =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    platform !== "" &&
    styleName.length > 0 &&
    selectedLanguages.length > 0 &&
    defaultLanguage !== "" &&
    !styleError &&
    !stylesLoading &&
    !saving;

  useEffect(() => {
    let cancelled = false;
    setStylesLoading(true);
    setStyleError(null);

    Promise.all([client.listStyles(), client.listSystemStyles()])
      .then(([nextStyles, nextSystemStyles]) => {
        if (!cancelled) {
          setStyles(nextStyles);
          setSystemStyles(nextSystemStyles);
          setStylesLoading(false);
        }
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setStyles([]);
          setSystemStyles([]);
          setStyleName("");
          setSystemStyleName("");
          setStyleError(formatApiError(nextError));
          setStylesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      let productId = createdProductId;
      if (!productId) {
        const product = await client.createProduct({
          description: description.trim(),
          name: name.trim()
        });
        productId = product.id;
        setCreatedProductId(product.id);
      }
      await client.configureProduct(productId, {
        default_language: defaultLanguage as Language,
        languages: selectedLanguages,
        platform: platform as Platform,
        brand_style: styleName,
        ...(systemStyleName ? { system_style: systemStyleName } : {})
      });
      navigate(`/products/${productId}`);
    } catch (nextError: unknown) {
      setError(formatApiError(nextError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <WorkSurface title={t("product.details")}>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            {t("product.name")}
            <input
              className={inputClasses}
              name="name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Checkout App"
              value={name}
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            {t("product.description")}
            <textarea
              className={`${inputClasses} min-h-28 resize-y`}
              name="description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("product.descriptionPlaceholder")}
              value={description}
            />
          </label>

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
            <div className="grid gap-1 text-sm font-medium text-zinc-700">
              <span>{t("product.style")}</span>
              <input name="brand_style" type="hidden" value={styleName} />
              <StylePickerDialog
                disabledReason={stylesLoading ? t("product.stylesLoading") : styleError ? t("product.stylesUnavailable") : undefined}
                getStyle={client.getStyle}
                onConfirm={setStyleName}
                platform={platform}
                selectedStyleName={styleName}
                styles={styles}
              />
            </div>
          </div>

          {systemStyles.length > 0 ? (
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              {t("product.systemStyle")}
              <select
                className={inputClasses}
                name="system_style"
                onChange={(event) => setSystemStyleName(event.target.value)}
                value={systemStyleName}
              >
                <option value="">{t("product.noSystemStyle")}</option>
                {systemStyles.map((ss) => (
                  <option key={ss.name} value={ss.name}>
                    {ss.name}
                    {ss.description ? ` — ${ss.description}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

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

          <div className="flex justify-end">
            <button className={primaryButtonClasses} disabled={!canSubmit} type="submit">
              {saving ? t("action.creating") : t("action.createProduct")}
            </button>
          </div>
        </form>
      </WorkSurface>

      <div className="space-y-3">
        {saving ? (
          <StatePanel state="loading" title={t("product.submission")}>
            {t("product.submissionCreateHelp")}
          </StatePanel>
        ) : error ? (
          <StatePanel state="error" title={t("product.submissionRejected")}>
            {error.error_code} - {error.message}
            {createdProductId ? (
              <span className="mt-2 block">{t("product.retryConfiguration").replace("{productId}", createdProductId)}</span>
            ) : null}
          </StatePanel>
        ) : styleError ? (
          <StatePanel state="error" title={t("product.stylesUnavailable")}>
            {styleError.error_code} - {styleError.message}
          </StatePanel>
        ) : canSubmit ? (
          <StatePanel state="empty" title={t("product.readyToCreate")}>
            {t("product.readyToCreateHelp")}
          </StatePanel>
        ) : (
          <StatePanel state="empty" title={t("product.requiredFields")}>
            {t("product.requiredFieldsHelp")}
          </StatePanel>
        )}
      </div>
    </div>
  );

  function updateSelectedLanguage(language: Language, checked: boolean) {
    const nextSelected = checked ? [...selectedLanguages, language] : selectedLanguages.filter((selected) => selected !== language);
    setSelectedLanguages(nextSelected);
    setDefaultLanguage(deriveDefaultLanguage(nextSelected, defaultLanguage || undefined));
  }
}

function browserNavigate(pathname: string) {
  if (typeof window !== "undefined") {
    window.location.assign(pathname);
  }
}

const inputClasses =
  "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm transition placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

const primaryButtonClasses =
  "inline-flex items-center justify-center rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
