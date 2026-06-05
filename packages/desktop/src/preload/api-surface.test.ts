import { describe, it, expect } from "vitest";
import { readonlyApi } from "./index.js";

const ALLOWED_METHODS = new Set([
  "listProducts",
  "getProduct",
  "listArtifacts",
  "getArtifact",
  "listRequirements",
  "getRequirement",
  "formaServerStatus",
  "formaServerBaseUrl",
  "listStyles",
  "getStyle",
]);

describe("preload readonly API surface (SPEC-IF-DESKTOP-001)", () => {
  it("exposes exactly the allowed readonly methods", () => {
    const exposed = Object.keys(readonlyApi);
    expect(new Set(exposed)).toEqual(ALLOWED_METHODS);
  });

  it("exposes no mutation methods", () => {
    const mutationPatterns = [
      "create",
      "update",
      "delete",
      "save",
      "generate",
      "refine",
      "change",
      "rollback",
      "export",
      "sync",
      "init",
      "write",
      "set",
      "post",
      "put",
      "patch",
    ];
    const exposed = Object.keys(readonlyApi);
    for (const method of exposed) {
      const lower = method.toLowerCase();
      for (const pattern of mutationPatterns) {
        expect(lower, `method "${method}" looks like a mutation (contains "${pattern}")`).not.toContain(pattern);
      }
    }
  });

  it("all exposed methods are functions", () => {
    for (const [key, val] of Object.entries(readonlyApi)) {
      expect(typeof val, `${key} should be a function`).toBe("function");
    }
  });
});
