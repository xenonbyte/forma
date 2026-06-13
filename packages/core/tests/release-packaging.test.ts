import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(repoUrl(path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
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

describe("Lucide icon library release packaging", () => {
  // PLAN-TASK-013 Option A: the vendored lucide-icons.json lives at
  // packages/core/assets/, core's `files` whitelist stays ["dist"], and the
  // core build copies assets/ into dist/assets/ so the JSON ships in the npm
  // tarball. These assertions lock that contract so the runtime lazy-load can
  // never silently break in a published install.

  it("commits the vendored lucide-icons.json under packages/core/assets", async () => {
    expect(await fileExists("packages/core/assets/lucide-icons.json")).toBe(true);

    const raw = await readFile(repoUrl("packages/core/assets/lucide-icons.json"), "utf8");
    const table = JSON.parse(raw) as Record<string, { svg: string; tags: string[]; categories: string[] }>;
    const names = Object.keys(table);
    expect(names.length).toBeGreaterThan(1000);

    const sample = table[names[0]];
    expect(typeof sample.svg).toBe("string");
    expect(sample.svg).toContain("<svg");
    expect(Array.isArray(sample.tags)).toBe(true);
    expect(Array.isArray(sample.categories)).toBe(true);
  });

  it("ships the JSON inside dist via the core build asset-copy step", async () => {
    const corePackage = await readJson("packages/core/package.json");
    // The whitelist must stay dist-only; assets/ ships only through dist/assets/.
    // This is a build-independent contract check — no dist/ read required.
    expect(corePackage.files).toEqual(["dist"]);
    // The build script must invoke copy-core-assets.mjs so assets/ lands in dist/.
    expect(corePackage.scripts?.build ?? "").toContain("copy-core-assets.mjs");
  });
});
