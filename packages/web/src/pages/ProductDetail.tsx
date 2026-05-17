import { useEffect, useState, type FormEvent } from "react";

import {
  apiClient,
  formatApiError,
  type ApiErrorInfo,
  type BaselineNavigation,
  type CreateRequirementInput,
  type FormaApiClient,
  type Product,
  type RequirementWithDocument
} from "../api.js";
import { PrimaryActionLink, StatePanel, WorkSurface } from "../components/Layout.js";
import { StatusBadge, type ConfigStatus } from "../components/StatusBadge.js";

export interface ProductDetailProps {
  client?: Pick<FormaApiClient, "archiveRequirement" | "createRequirement" | "getProduct" | "listRequirements">;
  params: Record<string, string>;
}

type ProductDetailState =
  | { status: "error"; error: ApiErrorInfo }
  | { status: "loading" }
  | { product: Product; requirements: RequirementWithDocument[]; status: "ready" };

export function ProductDetail({ client = apiClient, params }: ProductDetailProps) {
  const productId = params.productId ?? "";
  const [actionError, setActionError] = useState<ApiErrorInfo | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [documentMd, setDocumentMd] = useState("");
  const [navigationJson, setNavigationJson] = useState("[]");
  const [pagesJson, setPagesJson] = useState("");
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<ProductDetailState>({ status: "loading" });
  const [title, setTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    Promise.all([client.getProduct(productId), client.listRequirements(productId)])
      .then(([product, requirements]) => {
        if (!cancelled) {
          setState({ product, requirements, status: "ready" });
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

  const parsedPages = parseJsonArray(pagesJson);
  const parsedNavigation = parseJsonArray(navigationJson);
  const canCreateRequirement =
    title.trim().length > 0 && documentMd.trim().length > 0 && parsedPages.ok && parsedPages.value.length > 0 && parsedNavigation.ok && !creating;

  async function handleCreateRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateRequirement) {
      return;
    }

    setActionError(null);
    setCreating(true);
    try {
      await client.createRequirement(productId, {
        document_md: documentMd.trim(),
        navigation: parsedNavigation.value as BaselineNavigation[],
        pages: parsedPages.value as CreateRequirementInput["pages"],
        title: title.trim()
      });
      setDocumentMd("");
      setNavigationJson("[]");
      setPagesJson("");
      setTitle("");
      setReloadKey((value) => value + 1);
    } catch (error: unknown) {
      setActionError(formatApiError(error));
    } finally {
      setCreating(false);
    }
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
      <StatePanel state="loading" title="Product workspace">
        Loading product record and requirement history.
      </StatePanel>
    );
  }

  if (state.status === "error") {
    return (
      <StatePanel action={<PrimaryActionLink href="/products">Products</PrimaryActionLink>} state="error" title="Product unavailable">
        {state.error.error_code} - {state.error.message}
      </StatePanel>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-3">
        <section className={summaryPanelClasses}>
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Baseline</p>
          <div className="mt-3">
            <PrimaryActionLink href={`/products/${productId}/baseline`}>Baseline</PrimaryActionLink>
          </div>
        </section>
        <section className={summaryPanelClasses}>
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Requirements</p>
          <p className="mt-2 text-sm font-semibold text-zinc-950">{state.requirements.length}</p>
          <p className="mt-1 text-sm text-zinc-600">Records loaded for this product.</p>
        </section>
        {actionError ? (
          <StatePanel state="error" title="Action result">
            {actionError.error_code} - {actionError.message}
          </StatePanel>
        ) : (
          <section className={summaryPanelClasses}>
            <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Archive gate</p>
            <p className="mt-2 text-sm text-zinc-600">Archive is available only for active requirements.</p>
          </section>
        )}
      </div>

      <WorkSurface title="Product configuration">
        <div className="grid gap-4 text-sm md:grid-cols-4">
          <Fact label="Product ID" value={state.product.id} />
          <Fact label="Platform" value={state.product.platform ?? "Not configured"} />
          <Fact label="Style" value={state.product.style?.name ?? "Not configured"} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">Config status</p>
            <div className="mt-2">
              <StatusBadge status={configStatus(state.product)} />
            </div>
          </div>
        </div>
      </WorkSurface>

      {state.requirements.length === 0 ? (
        <StatePanel state="empty" title="No requirements">
          Submitted and active requirement records will appear here.
        </StatePanel>
      ) : (
        <WorkSurface title="Requirement list">
          <div className="divide-y divide-zinc-200">
            {state.requirements.map((requirement) => (
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
                <p className="self-center text-sm text-zinc-600">{requirement.pages.length} pages</p>
                <button
                  className={secondaryButtonClasses}
                  disabled={requirement.status !== "active" || archiving === requirement.id}
                  onClick={() => void handleArchive(requirement.id)}
                  type="button"
                >
                  {archiving === requirement.id ? "Archiving" : "Archive"}
                </button>
              </div>
            ))}
          </div>
        </WorkSurface>
      )}

      <WorkSurface title="New requirement">
        <form className="grid gap-4" onSubmit={handleCreateRequirement}>
          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            Title
            <input className={inputClasses} onChange={(event) => setTitle(event.target.value)} placeholder="Checkout update" value={title} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            Document markdown
            <textarea className={`${inputClasses} min-h-28 resize-y font-mono`} onChange={(event) => setDocumentMd(event.target.value)} value={documentMd} />
          </label>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Pages JSON
              <textarea className={`${inputClasses} min-h-32 resize-y font-mono`} onChange={(event) => setPagesJson(event.target.value)} value={pagesJson} />
            </label>
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Navigation JSON
              <textarea
                className={`${inputClasses} min-h-32 resize-y font-mono`}
                onChange={(event) => setNavigationJson(event.target.value)}
                value={navigationJson}
              />
            </label>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-500">
              {canCreateRequirement ? "Payload is ready." : "Submit requires title, document, at least one page, and navigation JSON."}
            </p>
            <button className={primaryButtonClasses} disabled={!canCreateRequirement} type="submit">
              {creating ? "Submitting" : "Submit requirement"}
            </button>
          </div>
        </form>
      </WorkSurface>
    </div>
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
  if (product.platform && product.style && product.components_initialized) {
    return "initialized";
  }

  if (product.platform && product.style) {
    return "configured";
  }

  return "unconfigured";
}

function parseJsonArray(value: string): { ok: false; value: [] } | { ok: true; value: unknown[] } {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? { ok: true, value: parsed } : { ok: false, value: [] };
  } catch {
    return { ok: false, value: [] };
  }
}

const inputClasses =
  "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm transition placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const primaryButtonClasses =
  "inline-flex items-center justify-center rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const secondaryButtonClasses =
  "inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
const summaryPanelClasses = "rounded-lg border border-zinc-200 bg-white p-4 shadow-sm";
const textLinkClasses =
  "inline-flex rounded-md text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
