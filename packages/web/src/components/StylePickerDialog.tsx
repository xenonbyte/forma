import { useEffect, useMemo, useRef, useState } from "react";

import { formatApiError, type ApiErrorInfo, type Platform, type StyleDetailPayload, type StyleMetadata } from "../api.js";
import { useT } from "../LocaleContext.js";
import { StylePreviewPanel, type StylePreviewType } from "./StylePreviewPanel.js";

export interface StylePickerDialogProps {
  disabledReason?: string;
  getStyle(name: string): Promise<StyleDetailPayload>;
  onConfirm(styleName: string): void;
  platform: Platform | "";
  selectedStyleName: string;
  styles: StyleMetadata[];
}

type DetailState =
  | { name: string; status: "idle" }
  | { detail: StyleDetailPayload; name: string; status: "ready" }
  | { error: ApiErrorInfo; name: string; status: "error" }
  | { name: string; status: "loading" };

const focusClasses = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const inputClasses = `rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm transition placeholder:text-zinc-400 ${focusClasses}`;

export function StylePickerDialog({
  disabledReason,
  getStyle,
  onConfirm,
  platform,
  selectedStyleName,
  styles
}: StylePickerDialogProps) {
  const tx = useT();
  const [candidateStyleName, setCandidateStyleName] = useState("");
  const [detailState, setDetailState] = useState<DetailState>({ name: "", status: "idle" });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const detailCache = useRef(new Map<string, StyleDetailPayload>());
  const detailRequests = useRef(new Map<string, Promise<StyleDetailPayload>>());
  const dialogRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const disabled = platform === "" || disabledReason !== undefined;
  const selectedStyle = styles.find((style) => style.name === selectedStyleName);
  const candidateStyle = styles.find((style) => style.name === candidateStyleName);
  const filteredStyles = useMemo(() => filterStyles(styles, query), [query, styles]);
  const previewType: StylePreviewType = platform === "" ? "web" : platform;
  const previewMetadata = detailState.status === "ready" ? detailState.detail.metadata : candidateStyle;
  const previewDesignMd = detailState.status === "ready" ? detailState.detail.designMd : undefined;
  const summary = disabled
    ? platform === ""
      ? tx("stylePicker.platformRequired")
      : (disabledReason ?? tx("stylePicker.selectStyle"))
    : selectedStyleName.length > 0
      ? tx("stylePicker.selectedSummary").replace("{styleName}", selectedStyleName)
      : tx("stylePicker.selectStyle");

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const candidateVisible = filteredStyles.some((style) => style.name === candidateStyleName);
    if (!candidateVisible) {
      setCandidateStyleName(filteredStyles[0]?.name ?? "");
    }
  }, [candidateStyleName, filteredStyles, open]);

  useEffect(() => {
    if (!open || candidateStyleName.length === 0) {
      setDetailState({ name: candidateStyleName, status: "idle" });
      return;
    }

    const cachedDetail = detailCache.current.get(candidateStyleName);
    if (cachedDetail) {
      setDetailState({ detail: cachedDetail, name: candidateStyleName, status: "ready" });
      return;
    }

    let cancelled = false;
    setDetailState({ name: candidateStyleName, status: "loading" });

    let request = detailRequests.current.get(candidateStyleName);
    if (!request) {
      request = getStyle(candidateStyleName)
        .then((detail) => {
          detailCache.current.set(candidateStyleName, detail);
          return detail;
        })
        .finally(() => {
          detailRequests.current.delete(candidateStyleName);
        });
      detailRequests.current.set(candidateStyleName, request);
    }

    request
      .then((detail) => {
        if (!cancelled) {
          setDetailState({ detail, name: candidateStyleName, status: "ready" });
        }
      })
      .catch((error: unknown) => {
        const formattedError = formatApiError(error);
        if (!cancelled) {
          setDetailState({ error: formattedError, name: candidateStyleName, status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [candidateStyleName, getStyle, open]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      searchInputRef.current?.focus();
      return;
    }

    if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }

      if (event.key === "Tab") {
        trapDialogFocus(event, dialogRef.current);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={`group flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition enabled:hover:border-amber-200 enabled:hover:bg-amber-50/40 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400 ${focusClasses}`}
        data-style-picker-trigger=""
        disabled={disabled}
        onClick={openDialog}
        ref={triggerRef}
        type="button"
      >
        <span className="min-w-0 truncate font-medium text-zinc-950 group-disabled:text-zinc-400">{summary}</span>
        <span className="shrink-0 text-xs font-medium text-zinc-500">{platform === "" ? "" : tx(`platform.${platform}`)}</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 p-4">
          <section
            aria-labelledby="style-picker-title"
            aria-modal="true"
            className="grid max-h-[90vh] w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl"
            ref={dialogRef}
            role="dialog"
          >
            <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold tracking-normal text-zinc-950" id="style-picker-title">
                  {tx("stylePicker.title")}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">{tx(`platform.${previewType}`)}</p>
              </div>
              <button
                aria-label={tx("action.close")}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-lg leading-none text-zinc-600 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 ${focusClasses}`}
                data-style-picker-close=""
                onClick={() => setOpen(false)}
                type="button"
              >
                X
              </button>
            </header>

            <div className="grid min-h-0 gap-4 overflow-auto p-5 lg:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.25fr)]">
              <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
                <label className="grid gap-1 text-sm font-medium text-zinc-700">
                  {tx("stylePicker.searchLabel")}
                  <input
                    className={inputClasses}
                    data-style-picker-search=""
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={tx("stylePicker.searchPlaceholder")}
                    ref={searchInputRef}
                    value={query}
                  />
                </label>

                <div aria-label={tx("stylePicker.candidateList")} className="min-h-0 space-y-2 overflow-auto pr-1" role="listbox">
                  {filteredStyles.length > 0 ? (
                    filteredStyles.map((style) => (
                      <StyleCandidateButton
                        active={style.name === candidateStyleName}
                        key={style.name}
                        onClick={() => setCandidateStyleName(style.name)}
                        style={style}
                      />
                    ))
                  ) : (
                    <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">{tx("stylePicker.noResults")}</p>
                  )}
                </div>
              </div>

              <div className="min-w-0 space-y-3">
                {detailState.status === "loading" ? <p className="text-sm text-zinc-500">{tx("stylePicker.loadingDetail")}</p> : null}
                {previewMetadata ? <StylePreviewPanel designMd={previewDesignMd} metadata={previewMetadata} previewType={previewType} /> : null}
                {detailState.status === "error" ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {tx("stylePicker.detailUnavailable")}: {detailState.error.error_code} - {detailState.error.message}
                  </p>
                ) : null}
              </div>
            </div>

            <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4">
              <button className={secondaryButtonClasses} data-style-picker-cancel="" onClick={() => setOpen(false)} type="button">
                {tx("action.cancel")}
              </button>
              <button
                className={primaryButtonClasses}
                data-style-picker-confirm=""
                disabled={!candidateStyle}
                onClick={() => {
                  if (candidateStyle) {
                    onConfirm(candidateStyle.name);
                    setOpen(false);
                  }
                }}
                type="button"
              >
                {tx("action.confirm")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );

  function openDialog() {
    if (disabled) {
      return;
    }

    const nextCandidate = selectedStyle?.name ?? styles[0]?.name ?? "";
    setCandidateStyleName(nextCandidate);
    setQuery("");
    setOpen(true);
  }
}

function StyleCandidateButton({
  active,
  onClick,
  style
}: {
  active: boolean;
  onClick(): void;
  style: StyleMetadata;
}) {
  const preview = stylePreviewTokens(style.variables);
  const variableEntries = Object.entries(style.variables ?? {});
  const variableLabel = `${variableEntries.length} ${variableEntries.length === 1 ? "variable" : "variables"}`;

  return (
    <button
      aria-selected={active}
      className={`block w-full rounded-lg border bg-white p-4 text-left shadow-sm transition hover:border-amber-200 hover:bg-amber-50/40 active:scale-[0.99] ${focusClasses} ${
        active ? "border-amber-300 ring-1 ring-amber-200" : "border-zinc-200"
      }`}
      data-style-picker-option={style.name}
      onClick={onClick}
      role="option"
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-normal text-zinc-950">{style.name}</h3>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600">{style.description}</p>
        </div>
        <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-500">{variableLabel}</span>
      </div>

      <div className="mt-4" data-primary={preview.primary} data-style-preview-strip="true">
        <div className="grid h-8 grid-cols-3 overflow-hidden border border-zinc-200 shadow-inner" style={{ borderRadius: preview.radius }}>
          <span aria-hidden="true" style={{ backgroundColor: preview.background }} />
          <span aria-hidden="true" style={{ backgroundColor: preview.primary }} />
          <span aria-hidden="true" style={{ backgroundColor: preview.textColor }} />
        </div>
      </div>
    </button>
  );
}

function filterStyles(styles: StyleMetadata[], query: string): StyleMetadata[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return styles;
  }

  return styles.filter((style) => `${style.name} ${style.description}`.toLowerCase().includes(normalizedQuery));
}

function stylePreviewTokens(variables: Partial<StyleMetadata["variables"]>) {
  return {
    background: tokenValue(variables.background, "#ffffff"),
    primary: tokenValue(variables.primary ?? variables["text-primary"], "#71717a"),
    textColor: tokenValue(variables["text-primary"], "#111827"),
    radius: cssLength(tokenValue(variables["border-radius"], "8px"))
  };
}

function tokenValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function cssLength(value: string): string {
  return /^-?\d+(?:\.\d+)?$/.test(value) && value !== "0" ? `${value}px` : value;
}

function trapDialogFocus(event: KeyboardEvent, dialog: HTMLElement | null): void {
  if (!dialog) {
    return;
  }

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("hidden"));
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

const primaryButtonClasses =
  "inline-flex items-center justify-center rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-300";

const secondaryButtonClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95";
