import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { SystemStyleMetadata } from "../api.js";
import { useT } from "../LocaleContext.js";
import { PlatformTemplatePreview } from "./PlatformTemplatePreview.js";

export interface SystemStylePickerDialogProps {
  disabledReason?: string;
  onConfirm(styleName: string): void;
  selectedStyleName: string;
  styles: SystemStyleMetadata[];
}

const focusClasses =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

export function SystemStylePickerDialog({
  disabledReason,
  onConfirm,
  selectedStyleName,
  styles,
}: SystemStylePickerDialogProps) {
  const tx = useT();
  const [candidateStyleName, setCandidateStyleName] = useState("");
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const disabled = disabledReason !== undefined || styles.length === 0;
  const selectedStyle = styles.find((style) => style.name === selectedStyleName);
  const candidateStyle = styles.find((style) => style.name === candidateStyleName);
  const summary = disabled
    ? (disabledReason ?? tx("systemStylePicker.noResults"))
    : selectedStyleName.length > 0
      ? tx("systemStylePicker.selectedSummary").replace("{styleName}", selectedStyleName)
      : tx("systemStylePicker.selectStyle");

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

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
        data-system-style-picker-trigger=""
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
          aria-labelledby="system-style-picker-title"
          aria-modal="true"
          className="grid max-h-[calc(100vh-3rem)] w-full max-w-[1360px] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-white shadow-2xl"
          data-system-style-picker-dialog="true"
          ref={dialogRef}
          role="dialog"
        >
          <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-7 py-4">
            <h2
              className="truncate text-[24px] font-semibold tracking-normal text-zinc-900"
              id="system-style-picker-title"
            >
              {tx("systemStylePicker.title")}
            </h2>
            <button
              aria-label={tx("action.close")}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-xl leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 ${focusClasses}`}
              data-system-style-picker-close=""
              onClick={() => setOpen(false)}
              type="button"
            >
              ✕
            </button>
          </header>

          <div className="grid min-h-0 grid-cols-[340px_minmax(0,1fr)] overflow-hidden">
            <aside className="min-h-0 border-r border-zinc-200 bg-zinc-50 p-5">
              <div
                aria-label={tx("systemStylePicker.candidateList")}
                className="grid max-h-full content-start gap-3 overflow-y-auto overflow-x-hidden pr-1"
                role="listbox"
              >
                {styles.map((style, index) => (
                  <SystemStyleCandidateButton
                    active={style.name === candidateStyleName}
                    key={style.name}
                    onClick={() => setCandidateStyleName(style.name)}
                    ref={index === 0 ? firstOptionRef : undefined}
                    style={style}
                  />
                ))}
              </div>
            </aside>

            <section className="min-w-0 overflow-hidden p-6">
              {candidateStyle ? <PlatformTemplatePreview kind="spec" metadata={candidateStyle} /> : null}
            </section>
          </div>

          <footer className="flex justify-end gap-3 border-t border-zinc-200 px-7 py-4">
            <button
              className={secondaryButtonClasses}
              data-system-style-picker-cancel=""
              onClick={() => setOpen(false)}
              type="button"
            >
              {tx("action.cancel")}
            </button>
            <button
              className={primaryButtonClasses}
              data-system-style-picker-confirm=""
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

    setCandidateStyleName(selectedStyle?.name ?? styles[0]?.name ?? "");
    setOpen(true);
  }
}

interface SystemStyleCandidateButtonProps {
  active: boolean;
  onClick(): void;
  style: SystemStyleMetadata;
}

const SystemStyleCandidateButton = forwardRef<HTMLButtonElement, SystemStyleCandidateButtonProps>(
  function SystemStyleCandidateButton({ active, onClick, style }, ref) {
    const tx = useT();
    return (
      <button
        aria-selected={active}
        className={`w-full rounded-2xl border p-4 text-left transition active:scale-[0.99] ${focusClasses} ${
          active ? "border-amber-300 bg-amber-50" : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
        }`}
        data-system-style-picker-option={style.name}
        onClick={onClick}
        ref={ref}
        role="option"
        type="button"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 gap-3">
            <span className="mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-100 bg-amber-100 text-zinc-950">
              <SpecIcon name={style.name} />
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
      </button>
    );
  },
);

function SpecIcon({ name }: { name: string }) {
  if (name.includes("mobile")) {
    return (
      <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
        <rect height="18" rx="2.5" stroke="currentColor" strokeWidth="1.7" width="11" x="6.5" y="3" />
        <path d="M10 17.5h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      </svg>
    );
  }
  if (name.includes("dense") || name.includes("data")) {
    return (
      <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
        <path d="M4 5h16M4 11h16M4 17h16M9 5v14M15 5v14" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (name.includes("access")) {
    return (
      <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 7.5v9M8.5 10h7M10 16.5l2-5 2 5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }
  if (name.includes("admin") || name.includes("enterprise")) {
    return (
      <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
        <path
          d="M5 6.5 12 3l7 3.5v10L12 21l-7-4.5v-10Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path d="M12 3v18M5 6.5l7 4 7-4" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      </svg>
    );
  }
  if (name.includes("fluent")) {
    return (
      <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
        <path
          d="m12 3 1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9L12 3Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24">
      <path
        d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"
        fill="#f59e0b"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
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
  "inline-flex items-center justify-center rounded-xl bg-amber-500 px-6 py-3 text-sm font-medium text-zinc-950 shadow-sm transition hover:bg-amber-400 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500";

const secondaryButtonClasses =
  "inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 active:scale-95";
