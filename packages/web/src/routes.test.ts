// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { matchRoute, navigateTo } from "./routes.js";

describe("matchRoute", () => {
  it("preserves hash for internal navigation targets", () => {
    const match = matchRoute("/products/P-123abc#new-requirement");

    expect(match.found).toBe(true);
    expect(match.pathname).toBe("/products/P-123abc");
    expect(match.hash).toBe("#new-requirement");
  });

  it("keeps delete navigation state when navigating back to products", () => {
    const deleteState = {
      productDelete: {
        cleanupPending: true,
        productId: "P-123abc",
        recoveryWarnings: ["Recovered orphaned requirement index"],
        sessionCleared: true
      }
    };

    window.history.replaceState({}, "", "/products/P-123abc");
    navigateTo("/products", deleteState);

    expect(window.location.pathname).toBe("/products");
    expect(window.history.state).toEqual(deleteState);
  });
});
