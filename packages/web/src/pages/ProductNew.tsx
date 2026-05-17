import { useState, type FormEvent } from "react";

import { apiClient, formatApiError, type ApiErrorInfo, type FormaApiClient } from "../api.js";
import { StatePanel, WorkSurface } from "../components/Layout.js";

export interface ProductNewProps {
  client?: Pick<FormaApiClient, "createProduct">;
  navigate?: (pathname: string) => void;
}

export function ProductNew({ client = apiClient, navigate = browserNavigate }: ProductNewProps) {
  const [description, setDescription] = useState("");
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const canSubmit = name.trim().length > 0 && description.trim().length > 0 && !saving;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const product = await client.createProduct({
        description: description.trim(),
        name: name.trim()
      });
      navigate(`/products/${product.id}`);
    } catch (nextError: unknown) {
      setError(formatApiError(nextError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <WorkSurface title="Product details">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            Name
            <input
              className={inputClasses}
              onChange={(event) => setName(event.target.value)}
              placeholder="Checkout App"
              value={name}
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-zinc-700">
            Description
            <textarea
              className={`${inputClasses} min-h-28 resize-y`}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Operational scope and product surface."
              value={description}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Platform
              <select className={`${inputClasses} disabled:cursor-not-allowed disabled:text-zinc-400`} disabled>
                <option>Configured after creation</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-zinc-700">
              Style
              <select className={`${inputClasses} disabled:cursor-not-allowed disabled:text-zinc-400`} disabled>
                <option>Selected after creation</option>
              </select>
            </label>
          </div>

          <div className="flex justify-end">
            <button className={primaryButtonClasses} disabled={!canSubmit} type="submit">
              {saving ? "Creating" : "Create product"}
            </button>
          </div>
        </form>
      </WorkSurface>

      <div className="space-y-3">
        {saving ? (
          <StatePanel state="loading" title="Submission">
            Creating product record.
          </StatePanel>
        ) : error ? (
          <StatePanel state="error" title="Submission rejected">
            {error.error_code} - {error.message}
          </StatePanel>
        ) : canSubmit ? (
          <StatePanel state="empty" title="Ready to create">
            Name and description will be sent to the product API.
          </StatePanel>
        ) : (
          <StatePanel state="empty" title="Required fields">
            Name and description are required before creation.
          </StatePanel>
        )}
      </div>
    </div>
  );
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
