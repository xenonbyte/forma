import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  formatApiError,
  type ApiErrorInfo,
  type BrandStyleContent,
  type Platform,
  type StyleMetadata,
} from "../api.js";
import { useT } from "../LocaleContext.js";
import { PlatformTemplatePreview } from "./PlatformTemplatePreview.js";

export interface StylePickerDialogProps {
  disabledReason?: string;
  getStyle(name: string): Promise<BrandStyleContent>;
  onConfirm(styleName: string): void;
  platform?: Platform | "";
  selectedStyleName: string;
  styles: StyleMetadata[];
}

const focusClasses =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

type DetailState =
  | { name: string; status: "idle" }
  | { detail: BrandStyleContent; name: string; status: "ready" }
  | { error: ApiErrorInfo; name: string; status: "error" }
  | { name: string; status: "loading" };

export function StylePickerDialog({
  disabledReason,
  getStyle,
  onConfirm,
  selectedStyleName,
  styles,
}: StylePickerDialogProps) {
  const tx = useT();
  const [candidateStyleName, setCandidateStyleName] = useState("");
  const [detailState, setDetailState] = useState<DetailState>({ name: "", status: "idle" });
  const [open, setOpen] = useState(false);
  const detailCache = useRef(new Map<string, BrandStyleContent>());
  const detailRequests = useRef(new Map<string, Promise<BrandStyleContent>>());
  const dialogRef = useRef<HTMLElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const disabled = disabledReason !== undefined;
  const selectedStyle = styles.find((style) => style.name === selectedStyleName);
  const candidateStyle = styles.find((style) => style.name === candidateStyleName);
  const previewMetadata = candidateStyle;
  const previewDesignMd =
    detailState.status === "ready" && detailState.name === candidateStyleName ? detailState.detail.designMd : undefined;
  const summary = disabled
    ? (disabledReason ?? tx("stylePicker.selectStyle"))
    : selectedStyleName.length > 0
      ? tx("stylePicker.selectedSummary").replace("{styleName}", selectedStyleName)
      : tx("stylePicker.selectStyle");

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

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
      firstOptionRef.current?.focus();
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
        <span className="shrink-0 text-xs font-medium text-zinc-500">{tx("stylePicker.open")}</span>
      </button>

      {open ? renderDialog() : null}
    </>
  );

  function renderDialog(): ReactNode {
    const dialog = (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
        <section
          aria-labelledby="style-picker-title"
          aria-modal="true"
          className="grid max-h-[calc(100vh-3rem)] w-full max-w-[1360px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-white shadow-2xl"
          data-style-picker-dialog="true"
          ref={dialogRef}
          role="dialog"
        >
          <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-7 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-[24px] font-semibold tracking-normal text-zinc-900" id="style-picker-title">
                {tx("stylePicker.title")}
              </h2>
            </div>
            <button
              aria-label={tx("action.close")}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-xl leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 ${focusClasses}`}
              data-style-picker-close=""
              onClick={() => setOpen(false)}
              type="button"
            >
              ✕
            </button>
          </header>

          <div className="grid min-h-0 grid-cols-[340px_minmax(0,1fr)] overflow-hidden">
            <aside className="min-h-0 border-r border-zinc-200 bg-zinc-50 p-5">
              <div
                aria-label={tx("stylePicker.candidateList")}
                className="grid max-h-full content-start gap-3 overflow-y-auto overflow-x-hidden pr-1"
                role="listbox"
              >
                {styles.length > 0 ? (
                  styles.map((style, index) => (
                    <StyleCandidateButton
                      active={style.name === candidateStyleName}
                      key={style.name}
                      onClick={() => setCandidateStyleName(style.name)}
                      ref={index === 0 ? firstOptionRef : undefined}
                      style={style}
                    />
                  ))
                ) : (
                  <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                    {tx("stylePicker.noResults")}
                  </p>
                )}
              </div>
            </aside>

            <section className="min-w-0 overflow-hidden p-6">
              {previewMetadata ? (
                <PlatformTemplatePreview designMd={previewDesignMd} kind="style" metadata={previewMetadata} />
              ) : null}
              {detailState.status === "error" && detailState.name === candidateStyleName ? (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {tx("stylePicker.detailUnavailable")}: {detailState.error.error_code} - {detailState.error.message}
                </p>
              ) : null}
            </section>
          </div>

          <footer className="flex justify-end gap-3 border-t border-zinc-200 px-7 py-4">
            <button
              className={secondaryButtonClasses}
              data-style-picker-cancel=""
              onClick={() => setOpen(false)}
              type="button"
            >
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
    );

    return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
  }

  function openDialog() {
    if (disabled) {
      return;
    }

    const nextCandidate = selectedStyle?.name ?? styles[0]?.name ?? "";
    setCandidateStyleName(nextCandidate);
    setOpen(true);
  }
}

interface StyleCandidateButtonProps {
  active: boolean;
  onClick(): void;
  style: StyleMetadata;
}

const StyleCandidateButton = forwardRef<HTMLButtonElement, StyleCandidateButtonProps>(function StyleCandidateButton(
  { active, onClick, style },
  ref,
) {
  const tx = useT();
  const category = style.category;

  return (
    <button
      aria-selected={active}
      className={`group w-full rounded-2xl border p-4 text-left transition active:scale-[0.99] ${focusClasses} ${
        active ? "border-amber-300 bg-amber-50" : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
      }`}
      data-style-picker-option={style.name}
      onClick={onClick}
      ref={ref}
      role="option"
      type="button"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 gap-3">
          <span className="mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-100 bg-zinc-100 text-amber-500">
            <StyleIcon name={style.name} />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold tracking-normal text-zinc-900">
              {formatDisplayName(style.name)}
            </span>
            <span className="mt-1 block break-words text-sm leading-5 text-zinc-500">{style.description}</span>
          </span>
        </span>
        {active ? (
          <span className="shrink-0 rounded-full bg-amber-500 px-2 py-1 text-xs font-semibold text-zinc-950">
            {tx("action.selected")}
          </span>
        ) : null}
      </span>
      {category ? <span className="sr-only">{category}</span> : null}
    </button>
  );
});

function StyleIcon({ name }: { name: string }) {
  if (name.includes("air") || name.includes("table")) {
    return (
      <svg aria-hidden="true" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M6.5 5.5a4 4 0 0 1 7.5 1.9 4.4 4.4 0 0 1 6 4.1v7h-5.5v-7.1a2.3 2.3 0 0 0-4.6 0v7.1H4.5v-6.1a3.2 3.2 0 0 1 3.2-3.2h1.7A3.9 3.9 0 0 1 6.5 5.5Z" />
      </svg>
    );
  }
  if (name.includes("minimal") || name.includes("clean")) {
    return <span className="h-6 w-6 rounded-full bg-zinc-500" />;
  }
  if (name.includes("enterprise") || name.includes("dashboard")) {
    return (
      <svg aria-hidden="true" className="h-6 w-6 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M4 20V9h6v11H4Zm5-13V4h6v16h-4V7H9Zm7 13V12h4v8h-4Z" />
      </svg>
    );
  }
  if (name.includes("editorial")) {
    return (
      <svg aria-hidden="true" className="h-6 w-6 text-violet-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M5 5.5A4.5 4.5 0 0 1 9.5 1H11v19H9.5A4.5 4.5 0 0 0 5 24V5.5Zm8-4.5h1.5A4.5 4.5 0 0 1 19 5.5V24a4.5 4.5 0 0 0-4.5-4.5H13V1Z" />
      </svg>
    );
  }
  if (name.includes("elegant")) {
    return <span className="h-6 w-6 rotate-45 rounded-sm bg-emerald-500" />;
  }
  if (name.includes("vibrant") || name.includes("color")) {
    return (
      <svg aria-hidden="true" className="h-6 w-6 text-rose-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M5 5h6v6H5V5Zm8 0h6v6h-6V5ZM5 13h6v6H5v-6Zm8 4a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 3 21 8l-9 5-9-5 9-5Zm-7 8.2 7 3.9 7-3.9V16l-7 4-7-4v-4.8Z" />
    </svg>
  );
}

function formatDisplayName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function trapDialogFocus(event: KeyboardEvent, dialog: HTMLElement | null): void {
  if (!dialog) {
    return;
  }

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
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
  "inline-flex items-center justify-center rounded-xl bg-zinc-950 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-300";

const secondaryButtonClasses =
  "inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 active:scale-95";
