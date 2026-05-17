import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./StatusBadge.js";

describe("StatusBadge", () => {
  it("renders active requirement status with success tone", () => {
    const html = renderToStaticMarkup(<StatusBadge status="active" />);

    expect(html).toContain("Active");
    expect(html).toContain("bg-emerald-50");
    expect(html).toContain("text-emerald-700");
  });

  it("renders pending design status with waiting tone", () => {
    const html = renderToStaticMarkup(<StatusBadge status="pending" />);

    expect(html).toContain("Pending");
    expect(html).toContain("bg-amber-50");
    expect(html).toContain("text-amber-700");
  });

  it("renders unknown config status with neutral fallback", () => {
    const html = renderToStaticMarkup(<StatusBadge status="not_loaded" />);

    expect(html).toContain("Not loaded");
    expect(html).toContain("bg-zinc-100");
    expect(html).toContain("text-zinc-600");
  });
});
