import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type PackageJson = {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  files?: string[];
  publishConfig?: Record<string, unknown>;
  scripts?: Record<string, string>;
};

const repoUrl = (path: string): URL => new URL(`../../../${path}`, import.meta.url);

async function readJson(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(repoUrl(path), "utf8")) as PackageJson;
}

describe("VZI runtime release packaging", () => {
  const publishedVziRuntimePackages = [
    "@vzi-core/types",
    "@vzi-core/format",
    "@vzi-core/parser",
    "@vzi-core/transformer",
  ];

  const packagePathByName: Record<string, string> = {
    "@vzi-core/types": "packages/vzi-types/package.json",
    "@vzi-core/format": "packages/vzi-format/package.json",
    "@vzi-core/parser": "packages/vzi-parser/package.json",
    "@vzi-core/transformer": "packages/vzi-transformer/package.json",
  };

  it("publishes every VZI runtime package that public Forma packages depend on", async () => {
    const consumerPackages = await Promise.all([
      readJson("packages/core/package.json"),
      readJson("packages/mcp/package.json"),
    ]);

    const runtimeDeps = new Set<string>();
    for (const pkg of consumerPackages) {
      for (const depName of Object.keys(pkg.dependencies ?? {})) {
        if (depName.startsWith("@vzi-core/")) {
          runtimeDeps.add(depName);
        }
      }
    }

    expect([...runtimeDeps].sort()).toEqual([...publishedVziRuntimePackages].sort());

    for (const depName of runtimeDeps) {
      const pkg = await readJson(packagePathByName[depName]);
      expect(pkg.name).toBe(depName);
      expect(pkg.private).not.toBe(true);
      expect(pkg.files).toEqual(["dist"]);
      expect(pkg.publishConfig).toMatchObject({ access: "public" });
    }
  });

  it("dry-run pack and npm publish scripts include VZI runtimes before their consumers", async () => {
    const rootPackage = await readJson("package.json");
    const packScript = rootPackage.scripts?.["pack:publish"] ?? "";
    const publishScript = rootPackage.scripts?.["publish:npm"] ?? "";

    for (const depName of publishedVziRuntimePackages) {
      const packIndex = packScript.indexOf(`--filter ${depName} pack --dry-run`);
      const publishIndex = publishScript.indexOf(`--filter ${depName} publish`);
      expect(packIndex, `pack:publish missing ${depName}`).toBeGreaterThanOrEqual(0);
      expect(publishIndex, `publish:npm missing ${depName}`).toBeGreaterThanOrEqual(0);

      expect(packIndex).toBeLessThan(packScript.indexOf("--filter @xenonbyte/forma-core pack --dry-run"));
      expect(packIndex).toBeLessThan(packScript.indexOf("--filter @xenonbyte/forma-mcp pack --dry-run"));
      expect(publishIndex).toBeLessThan(publishScript.indexOf("--filter @xenonbyte/forma-core publish"));
      expect(publishIndex).toBeLessThan(publishScript.indexOf("--filter @xenonbyte/forma-mcp publish"));
    }
  });
});
