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

  it("does not match the removed legacy design detail route", () => {
    const match = matchRoute("/products/P-123abc/requirements/R-12345678/designs/D-12345678");

    expect(match.found).toBe(false);
    expect(match.route.path).toBe("*");
  });

  it("matches the requirement-level design route and ignores page query params for path matching", () => {
    const match = matchRoute("/products/P-123abc/requirements/R-12345678/design?page_id=checkout-page");

    expect(match.found).toBe(true);
    expect(match.route.path).toBe("/products/:productId/requirements/:reqId/design");
    expect(match.params).toEqual({ productId: "P-123abc", reqId: "R-12345678" });
    expect(match.pathname).toBe("/products/P-123abc/requirements/R-12345678/design");
  });

  it("does not match the removed viewer routes while the design route still matches", () => {
    const requirementViewer = matchRoute("/products/P-123abc/requirements/R-12345678/viewer");
    expect(requirementViewer.found).toBe(false);
    expect(requirementViewer.route.path).toBe("*");

    const pageViewer = matchRoute("/products/P-123abc/requirements/R-12345678/pages/login/viewer");
    expect(pageViewer.found).toBe(false);
    expect(pageViewer.route.path).toBe("*");

    const design = matchRoute("/products/P-123abc/requirements/R-12345678/design");
    expect(design.found).toBe(true);
    expect(design.route.path).toBe("/products/:productId/requirements/:reqId/design");
  });

  it("keeps delete navigation state when navigating back to products", () => {
    const deleteState = {
      productDelete: {
        cleanupPending: true,
        productId: "P-123abc",
        recoveryWarnings: ["Recovered orphaned requirement index"],
        sessionCleared: true,
      },
    };

    window.history.replaceState({}, "", "/products/P-123abc");
    navigateTo("/products", deleteState);

    expect(window.location.pathname).toBe("/products");
    expect(window.history.state).toEqual(deleteState);
  });

  it("matches the settings route", () => {
    const match = matchRoute("/settings");

    expect(match.found).toBe(true);
    expect(match.route.path).toBe("/settings");
    expect(match.route.navGroup).toBe("settings");
    expect(match.pathname).toBe("/settings");
  });

  it("matches the version compare route (F3)", () => {
    const match = matchRoute("/products/P-0abc12/artifacts/A1/compare");
    expect(match.found).toBe(true);
    expect(match.params).toEqual({ productId: "P-0abc12", artifactId: "A1" });
  });
});
