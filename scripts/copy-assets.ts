import { constants } from "node:fs";
import { access, cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";

export interface AssetCopy {
  label: string;
  source: string;
  target: string;
}

export interface BuiltInStyleAsset {
  name: string;
  description: string;
  designMdPath: string;
}

export interface BuiltInStyleCheckOptions {
  minimumStyleCount?: number;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliAssetsDir = resolve(repoRoot, "packages/cli/dist/assets");
const repoStylesDir = resolve(repoRoot, "styles");
const minimumBuiltInStyleCount = 50;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const requiredStyleVariableKeys = [
  "primary",
  "background",
  "text-primary",
  "font-heading",
  "font-body",
  "border-radius",
  "spacing-unit"
];
const assetCopies: AssetCopy[] = [
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
    await assertPng(resolve(styleDir, "preview@2x.png"));
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
  if (!/^styles:\s*$/m.test(source)) {
    throw new Error("Expected styles/styles.yaml to contain a top-level styles list");
  }

  const styles: BuiltInStyleAsset[] = [];
  let current: (Partial<BuiltInStyleAsset> & { variableKeys: Set<string> }) | undefined;
  let inVariables = false;
  const flush = () => {
    if (!current) {
      return;
    }
    const entry = current;
    if (!entry.name || !entry.description || !entry.designMdPath) {
      throw new Error(`Incomplete built-in style entry in styles.yaml: ${JSON.stringify(entry)}`);
    }
    const missingVariables = requiredStyleVariableKeys.filter((key) => !entry.variableKeys.has(key));
    if (missingVariables.length > 0) {
      throw new Error(`Built-in style ${entry.name} is missing required variables: ${missingVariables.join(", ")}`);
    }
    styles.push({ name: entry.name, description: entry.description, designMdPath: entry.designMdPath });
  };

  for (const line of source.split(/\r?\n/)) {
    const nameMatch = line.match(/^  - name:\s*(.+)\s*$/);
    if (nameMatch) {
      flush();
      current = { name: parseYamlScalar(nameMatch[1]), variableKeys: new Set<string>() };
      inVariables = false;
      continue;
    }

    const descriptionMatch = line.match(/^    description:\s*(.+)\s*$/);
    if (descriptionMatch && current) {
      current.description = parseYamlScalar(descriptionMatch[1]);
      inVariables = false;
      continue;
    }

    const designPathMatch = line.match(/^    design_md_path:\s*(.+)\s*$/);
    if (designPathMatch && current) {
      current.designMdPath = parseYamlScalar(designPathMatch[1]);
      inVariables = false;
      continue;
    }

    if (/^    variables:\s*$/.test(line) && current) {
      inVariables = true;
      continue;
    }

    const variableMatch = line.match(/^      ([A-Za-z0-9_-]+):\s*.+$/);
    if (variableMatch && current && inVariables) {
      current.variableKeys.add(variableMatch[1]);
    }
  }
  flush();

  return styles;
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed) as string;
  }
  return trimmed;
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

async function assertPng(file: string): Promise<void> {
  const data = await readFile(file);
  if (data.length < pngSignature.length || !data.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`Expected a valid PNG preview: ${file}`);
  }

  if (data.length < 33) {
    throw new Error(`Expected a complete PNG preview: ${file}`);
  }

  const ihdrLength = data.readUInt32BE(8);
  const firstChunkType = data.subarray(12, 16).toString("ascii");
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (ihdrLength !== 13 || firstChunkType !== "IHDR" || width === 0 || height === 0) {
    throw new Error(`Expected a PNG preview with a nonzero IHDR: ${file}`);
  }

  let offset = 8;
  let foundIend = false;
  while (offset + 12 <= data.length) {
    const chunkLength = data.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const nextOffset = dataStart + chunkLength + 4;
    if (nextOffset > data.length) {
      throw new Error(`Expected a complete PNG chunk stream: ${file}`);
    }

    const chunkType = data.subarray(typeStart, dataStart).toString("ascii");
    if (chunkType === "IEND") {
      if (chunkLength !== 0) {
        throw new Error(`Expected a valid PNG IEND chunk: ${file}`);
      }
      foundIend = true;
      break;
    }

    offset = nextOffset;
  }

  if (!foundIend) {
    throw new Error(`Expected a PNG IEND chunk: ${file}`);
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
