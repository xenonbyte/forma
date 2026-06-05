import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SkeletonCard, SkeletonDetail, SkeletonList } from "./Skeleton.js";

describe("Skeleton components", () => {
  it("renders a fixed-size card skeleton", () => {
    const html = renderToStaticMarkup(<SkeletonCard />);

    expect(html).toContain('data-skeleton="card"');
    expect(html).toContain("h-[232px]");
  });

  it("renders three card skeletons by default", () => {
    const html = renderToStaticMarkup(<SkeletonList />);

    expect(html).toContain('data-skeleton="list"');
    expect(html.match(/data-skeleton="card"/g) ?? []).toHaveLength(3);
  });

  it("renders fixed detail skeleton sections", () => {
    const html = renderToStaticMarkup(<SkeletonDetail />);

    expect(html).toContain('data-skeleton="detail"');
    expect(html).toContain("h-[118px]");
    expect(html).toContain("h-[142px]");
    expect(html).toContain("h-[186px]");
    expect(html).toContain("h-[148px]");
  });
});
