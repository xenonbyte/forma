import { describe, expect, it } from "vitest";

import { matchRoute } from "./routes.js";

describe("matchRoute", () => {
  it("preserves hash for internal navigation targets", () => {
    const match = matchRoute("/products/P-123abc#new-requirement");

    expect(match.found).toBe(true);
    expect(match.pathname).toBe("/products/P-123abc");
    expect(match.hash).toBe("#new-requirement");
  });
});
