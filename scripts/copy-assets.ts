import { constants } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

export interface AssetCopy {
  label: string;
  source: string;
  target: string;
}

export interface BuiltInStyleAsset {
  name: string;
  description: string;
  designMdPath: string;
  tokensCssPath: string;
  componentsHtmlPath: string;
}

export interface BuiltInStyleCheckOptions {
  minimumStyleCount?: number;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliAssetsDir = resolve(repoRoot, "packages/cli/dist/assets");
const repoStylesDir = resolve(repoRoot, "styles");
const minimumBuiltInStyleCount = 50;
export const assetCopies: AssetCopy[] = [
  {
    label: "agent templates",
    source: resolve(repoRoot, "packages/agent/templates"),
    target: resolve(repoRoot, "packages/cli/dist/assets/agent/templates")
  },
  {
    label: "styles",
    source: resolve(repoRoot, "styles"),
    target: resolve(repoRoot, "packages/cli/dist/assets/styles")
  },
  {
    label: "craft",
    source: resolve(repoRoot, "craft"),
    target: resolve(repoRoot, "packages/cli/dist/assets/craft")
  },
  {
    label: "web dist",
    source: resolve(repoRoot, "packages/web/dist"),
    target: resolve(repoRoot, "packages/cli/dist/assets/web")
  }
];

export async function copyAssets(copies: AssetCopy[] = assetCopies): Promise<void> {
  for (const copy of copies) {
    assertSafeAssetTarget(copy.target);
    if (!(await pathExists(copy.source))) {
      if (isWebAssetCopy(copy)) {
        throw new Error(`Missing web dist: ${relative(repoRoot, copy.source)}. Run pnpm build before packaging the CLI.`);
      }
      console.log(`skip ${copy.label}: ${copy.source} does not exist`);
      continue;
    }
    if (copy.label === "styles") {
      await assertBuiltInStyles(copy.source);
    }
    if (isWebAssetCopy(copy)) {
      await assertWebAssets(copy.source);
    }

    await mkdir(dirname(copy.target), { recursive: true });
    await rm(copy.target, { recursive: true, force: true });
    await cp(copy.source, copy.target, { recursive: true });
    console.log(`copied ${copy.label}: ${copy.source} -> ${copy.target}`);
  }
}

export async function checkAssets(): Promise<void> {
  const sourceStyles = await assertBuiltInStyles(repoStylesDir);
  console.log(`validated styles: ${sourceStyles.length} built-in styles in ${relative(repoRoot, repoStylesDir)}`);

  await checkCopiedStyleAssets();
  await checkCopiedCraftAssets();
  await checkCopiedWebAssets();
}

export async function assertBuiltInStyles(
  stylesDirInput: string | URL,
  options: BuiltInStyleCheckOptions = {}
): Promise<BuiltInStyleAsset[]> {
  const stylesDir = filePath(stylesDirInput);
  const stylesIndex = resolve(stylesDir, "styles.yaml");
  const styles = parseStyleIndex(await readFile(stylesIndex, "utf8"));
  const minimumStyleCount = options.minimumStyleCount ?? minimumBuiltInStyleCount;
  if (styles.length < minimumStyleCount) {
    throw new Error(`Expected at least ${minimumStyleCount} built-in styles, found ${styles.length}`);
  }

  const seenNames = new Set<string>();
  for (const style of styles) {
    if (seenNames.has(style.name)) {
      throw new Error(`Duplicate built-in style name: ${style.name}`);
    }
    seenNames.add(style.name);

    assertSafeStyleDesignPath(style);
    const styleDir = resolve(stylesDir, style.name);
    assertPathInside(stylesDir, styleDir);
    await access(resolve(styleDir, "DESIGN.md"), constants.F_OK);
    await access(resolve(styleDir, "tokens.css"), constants.F_OK);
    await access(resolve(styleDir, "components.html"), constants.F_OK);
  }

  return styles;
}

export async function assertCopiedBuiltInStyles(
  sourceStylesDirInput: string | URL,
  copiedStylesDirInput: string | URL
): Promise<BuiltInStyleAsset[]> {
  const sourceStylesDir = filePath(sourceStylesDirInput);
  const copiedStylesDir = filePath(copiedStylesDirInput);
  const sourceStyles = await assertBuiltInStyles(sourceStylesDir, { minimumStyleCount: 0 });
  const copiedStyles = await assertBuiltInStyles(copiedStylesDir, { minimumStyleCount: sourceStyles.length });
  assertMatchingStyleNames(sourceStyles, copiedStyles);
  return copiedStyles;
}

export async function assertWebAssets(webAssetsDirInput: string | URL): Promise<void> {
  const webAssetsDir = filePath(webAssetsDirInput);
  await access(resolve(webAssetsDir, "index.html"), constants.F_OK);

  const assetFiles = await listFiles(resolve(webAssetsDir, "assets"));
  if (!assetFiles.some((file) => file.endsWith(".js"))) {
    throw new Error(`Expected Web assets to include at least one JavaScript bundle in ${resolve(webAssetsDir, "assets")}`);
  }
  if (!assetFiles.some((file) => file.endsWith(".css"))) {
    throw new Error(`Expected Web assets to include at least one CSS bundle in ${resolve(webAssetsDir, "assets")}`);
  }
}

export async function assertCraftAssets(craftDirInput: string | URL): Promise<void> {
  const craftDir = filePath(craftDirInput);
  await access(resolve(craftDir, "color.md"), constants.F_OK);
}

function assertSafeAssetTarget(target: string): void {
  const relativeTarget = relative(cliAssetsDir, resolve(target));
  if (relativeTarget === "" || relativeTarget.startsWith("..") || relativeTarget.startsWith("/")) {
    throw new Error(`Refusing to copy assets outside ${cliAssetsDir}: ${target}`);
  }
}

async function checkCopiedStyleAssets(): Promise<void> {
  const copiedStylesDir = resolve(cliAssetsDir, "styles");
  if (!(await pathExists(copiedStylesDir))) {
    console.log(`skip copied styles: ${relative(repoRoot, copiedStylesDir)} does not exist; run pnpm build to create it`);
    return;
  }

  const copiedStyles = await assertCopiedBuiltInStyles(repoStylesDir, copiedStylesDir);
  console.log(`validated copied styles: ${copiedStyles.length} built-in styles in ${relative(repoRoot, copiedStylesDir)}`);
}

async function checkCopiedCraftAssets(): Promise<void> {
  const copiedCraftDir = resolve(cliAssetsDir, "craft");
  if (!(await pathExists(copiedCraftDir))) {
    console.log(`skip copied craft: ${relative(repoRoot, copiedCraftDir)} does not exist; run pnpm build to create it`);
    return;
  }

  await assertCraftAssets(copiedCraftDir);
  console.log(`validated copied craft assets in ${relative(repoRoot, copiedCraftDir)}`);
}

async function checkCopiedWebAssets(): Promise<void> {
  const copiedWebAssetsDir = resolve(cliAssetsDir, "web");
  await assertWebAssets(copiedWebAssetsDir);
  console.log(`validated copied web assets in ${relative(repoRoot, copiedWebAssetsDir)}`);
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const file = resolve(root, entry.name);
      if (entry.isDirectory()) {
        return listFiles(file);
      }
      if (entry.isFile()) {
        return [file];
      }
      return [];
    })
  );
  return files.flat();
}

function isWebAssetCopy(copy: AssetCopy): boolean {
  return copy.label === "web dist";
}

function filePath(value: string | URL): string {
  return value instanceof URL ? fileURLToPath(value) : value;
}

function assertMatchingStyleNames(sourceStyles: BuiltInStyleAsset[], copiedStyles: BuiltInStyleAsset[]): void {
  const sourceNames = sourceStyles.map((style) => style.name).sort();
  const copiedNames = copiedStyles.map((style) => style.name).sort();
  const missing = sourceNames.filter((name) => !copiedNames.includes(name));
  const extra = copiedNames.filter((name) => !sourceNames.includes(name));

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Copied built-in styles do not match source styles: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`
    );
  }
}

function parseStyleIndex(source: string): BuiltInStyleAsset[] {
  const doc = load(source) as { styles?: Array<Record<string, string>> };
  if (!doc?.styles || !Array.isArray(doc.styles)) {
    throw new Error("Expected styles/styles.yaml to contain a styles list");
  }
  return doc.styles.map((s) => {
    if (!s.name || !s.description || !s.design_md_path || !s.tokens_css_path || !s.components_html_path) {
      throw new Error(`Incomplete built-in style entry: ${JSON.stringify(s)}`);
    }
    return {
      name: s.name,
      description: s.description,
      designMdPath: s.design_md_path,
      tokensCssPath: s.tokens_css_path,
      componentsHtmlPath: s.components_html_path
    };
  });
}

function assertSafeStyleDesignPath(style: BuiltInStyleAsset): void {
  const value = style.designMdPath;
  const normalized = posix.normalize(value);
  const segments = value.split("/");
  if (
    isAbsolute(value) ||
    posix.isAbsolute(value) ||
    normalized !== value ||
    segments.length !== 3 ||
    segments[0] !== "styles" ||
    segments[1] !== style.name ||
    segments[2] !== "DESIGN.md"
  ) {
    throw new Error(`Invalid built-in style design path for ${style.name}: ${value}`);
  }
}

function assertPathInside(root: string, file: string): void {
  const relativePath = relative(resolve(root), resolve(file));
  if (relativePath === "" || relativePath.startsWith("..") || relativePath.startsWith(sep)) {
    throw new Error(`Expected style asset to stay inside ${root}: ${file}`);
  }
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return false;
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv.includes("--check") ? checkAssets() : copyAssets();
  command.catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
