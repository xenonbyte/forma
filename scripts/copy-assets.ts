import { constants } from "node:fs";
import { access, cp, mkdir, readFile, rm, stat } from "node:fs/promises";
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliAssetsDir = resolve(repoRoot, "packages/cli/dist/assets");
const repoStylesDir = resolve(repoRoot, "styles");
const cliDistDir = resolve(repoRoot, "packages/cli/dist");
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
      console.log(`skip ${copy.label}: ${copy.source} does not exist`);
      continue;
    }
    if (copy.label === "styles") {
      await assertBuiltInStyles(copy.source);
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
}

export async function assertBuiltInStyles(stylesDir: string): Promise<BuiltInStyleAsset[]> {
  const stylesIndex = resolve(stylesDir, "styles.yaml");
  const styles = parseStyleIndex(await readFile(stylesIndex, "utf8"));
  if (styles.length < minimumBuiltInStyleCount) {
    throw new Error(`Expected at least 50 built-in styles, found ${styles.length}`);
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

function assertSafeAssetTarget(target: string): void {
  const relativeTarget = relative(cliAssetsDir, resolve(target));
  if (relativeTarget === "" || relativeTarget.startsWith("..") || relativeTarget.startsWith("/")) {
    throw new Error(`Refusing to copy assets outside ${cliAssetsDir}: ${target}`);
  }
}

async function checkCopiedStyleAssets(): Promise<void> {
  const copiedStylesDir = resolve(cliAssetsDir, "styles");
  if (!(await pathExists(cliDistDir))) {
    console.log(`skip copied styles: ${relative(repoRoot, cliDistDir)} does not exist`);
    return;
  }

  const cliWasBuiltAfterSourceStyles = await isNewerThan(resolve(cliDistDir, "index.js"), resolve(repoStylesDir, "styles.yaml"));
  if (!(await pathExists(copiedStylesDir))) {
    if (cliWasBuiltAfterSourceStyles) {
      throw new Error(`Expected copied styles at ${copiedStylesDir}; run pnpm build to refresh CLI assets`);
    }
    console.log(`skip copied styles: ${relative(repoRoot, copiedStylesDir)} does not exist; run pnpm build to create it`);
    return;
  }

  const copiedStylesAreCurrent = await isNewerThan(resolve(copiedStylesDir, "styles.yaml"), resolve(repoStylesDir, "styles.yaml"));
  if (!copiedStylesAreCurrent && !cliWasBuiltAfterSourceStyles) {
    console.log(`skip copied styles: ${relative(repoRoot, copiedStylesDir)} is older than source styles; run pnpm build to refresh it`);
    return;
  }

  const copiedStyles = await assertBuiltInStyles(copiedStylesDir);
  console.log(`validated copied styles: ${copiedStyles.length} built-in styles in ${relative(repoRoot, copiedStylesDir)}`);
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
    if (!current.name || !current.description || !current.designMdPath) {
      throw new Error(`Incomplete built-in style entry in styles.yaml: ${JSON.stringify(current)}`);
    }
    const missingVariables = requiredStyleVariableKeys.filter((key) => !current.variableKeys.has(key));
    if (missingVariables.length > 0) {
      throw new Error(`Built-in style ${current.name} is missing required variables: ${missingVariables.join(", ")}`);
    }
    styles.push({ name: current.name, description: current.description, designMdPath: current.designMdPath });
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
}

async function isNewerThan(file: string, reference: string): Promise<boolean> {
  try {
    const [fileStat, referenceStat] = await Promise.all([stat(file), stat(reference)]);
    return fileStat.mtimeMs + 1000 >= referenceStat.mtimeMs;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv.includes("--check") ? checkAssets() : copyAssets();
  command.catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
