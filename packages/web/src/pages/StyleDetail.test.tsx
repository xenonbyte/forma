import { describe, expect, it } from "vitest";

import { isStylePreviewImageUrl } from "./StyleDetail.js";

describe("isStylePreviewImageUrl", () => {
  it("only accepts explicit preview image endpoints", () => {
    expect(isStylePreviewImageUrl("/api/styles/linear/preview/image")).toBe(true);
    expect(isStylePreviewImageUrl("/api/styles/linear/preview")).toBe(false);
    expect(isStylePreviewImageUrl(undefined)).toBe(false);
  });
});
