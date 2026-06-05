import { describe, expect, it } from "vitest";
import { workspaceAliases } from "../../../vitest.config.ts";

describe("Vitest workspace aliases", () => {
  const expectedVziAliases: Record<string, string> = {
    "@vzi-core/types": "../../../packages/vzi-types/src/index.ts",
    "@vzi-core/format": "../../../packages/vzi-format/src/index.ts",
    "@vzi-core/parser": "../../../packages/vzi-parser/src/index.ts",
    "@vzi-core/transformer": "../../../packages/vzi-transformer/src/index.ts",
  };

  it("resolves VZI workspace packages to source files during clean test runs", () => {
    for (const [packageName, relativePath] of Object.entries(expectedVziAliases)) {
      expect(workspaceAliases[packageName], packageName).toBe(new URL(relativePath, import.meta.url).pathname);
      expect(workspaceAliases[packageName], packageName).not.toContain("/dist/");
    }
  });
});
