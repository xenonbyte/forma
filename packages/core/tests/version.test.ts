import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formaCoreVersion } from "../src/index.js";

const packageJsonPaths = [
  "packages/agent/package.json",
  "packages/cli/package.json",
  "packages/core/package.json",
  "packages/mcp/package.json",
  "packages/server/package.json",
  "packages/web/package.json",
];

describe("published version metadata", () => {
  it("keeps runtime and package versions in sync", async () => {
    for (const packageJsonPath of packageJsonPaths) {
      const packageJson = JSON.parse(await readFile(resolve(packageJsonPath), "utf8")) as { version: string };
      expect(packageJson.version, packageJsonPath).toBe(formaCoreVersion);
    }
  });
});
