import { useEffect, useState } from "react";

import type { ApiErrorInfo } from "../api.js";
import { useT } from "../LocaleContext.js";

export interface ConfirmDeleteDialogProps {
  open: boolean;
  product: { id: string; name: string };
  busy?: boolean;
  error?: ApiErrorInfo | null;
  onCancel(): void;
  onConfirm(confirmProductId: string): void;
}

export function ConfirmDeleteDialog({ busy = false, error, onCancel, onConfirm, open, product }: ConfirmDeleteDialogProps) {
  const t = useT();
  const [confirmation, setConfirmation] = useState("");
  const canConfirm = open && !busy && confirmation === product.id;

  useEffect(() => {
    if (open) {
      setConfirmation("");
    }
  }, [open, product.id]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4 py-6" role="dialog">
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-normal text-red-700">{t("product.dangerZone")}</p>
            <h2 className="mt-1 text-base font-semibold tracking-normal text-zinc-950">{t("deleteDialog.title")}</h2>
          </div>
          <button aria-label={t("action.close")} className={iconButtonClasses} disabled={busy} onClick={onCancel} type="button">
            <span aria-hidden="true">x</span>
          </button>
        </div>

        <div className="grid gap-4 px-4 py-4 text-sm text-zinc-700">
          <p>{t("deleteDialog.description")}</p>
          <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">{t("product.name")}</span>
              <span className="truncate font-semibold text-zinc-950">{product.name}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">{t("product.id")}</span>
              <span className="font-mono text-xs font-semibold text-zinc-900">{product.id}</span>
            </div>
            <div className="grid gap-1">
              <span className="text-zinc-500">{t("deleteDialog.scopeLabel")}</span>
              <span className="text-zinc-900">{t("deleteDialog.scope")}</span>
            </div>
          </div>

          <label className="grid gap-1 font-medium text-zinc-700">
            {t("deleteDialog.typeProductId")}
            <input
              autoComplete="off"
              className={inputClasses}
              disabled={busy}
              name="confirm_product_id"
              onChange={(event) => setConfirmation(event.target.value)}
              value={confirmation}
            />
          </label>

          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error.error_code} - {error.message}</p> : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:justify-end">
          <button className={secondaryButtonClasses} disabled={busy} onClick={onCancel} type="button">
            {t("action.cancel")}
          </button>
          <button className={dangerButtonClasses} data-confirm-delete-final="true" disabled={!canConfirm} onClick={() => onConfirm(confirmation)} type="button">
            {busy ? t("action.deleting") : t("action.deleteProduct")}
          </button>
        </div>
      </section>
    </div>
  );
}

const dangerButtonClasses =
  "inline-flex items-center justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500";
const iconButtonClasses =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950 disabled:cursor-not-allowed disabled:text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const inputClasses =
  "rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-sm text-zinc-950 shadow-sm transition placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500";
const secondaryButtonClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
