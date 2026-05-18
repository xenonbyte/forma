import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildServer } from "@xenonbyte/forma-server";
import { createFormaStore, FormaError, PencilService, type Design } from "@xenonbyte/forma-core";

const smokePrompt =
  "Create a simple mobile login page with title, email input, password input, primary login button, and forgot password link. Use the product design style variables.";

const componentPrompt =
  "Create a concise mobile component library using the product design style variables. Include text input, password input, primary button, text link, and page title components.";

async function main(): Promise<void> {
  ensureHomebrewPencilOnPath();

  const home = await mkdtemp(join(tmpdir(), "forma-pencil-smoke-"));
  try {
    const result = await runSmoke(home);
    console.log("Pencil smoke OK");
    console.log(`FORMA_HOME=${home}`);
    console.log(`product_id=${result.productId}`);
    console.log(`requirement_id=${result.requirementId}`);
    console.log(`design_id=${result.designId}`);
    console.log(`design.pen=${result.persistedPenPath}`);
    console.log(`preview@2x.png=${result.persistedPreviewPath}`);
    console.log(`annotation_count=${result.annotationCount}`);
    console.log(`fetched_preview_bytes=${result.fetchedPreviewBytes}`);
  } catch (error) {
    console.error("Pencil smoke failed");
    console.error(`FORMA_HOME=${home}`);
    printError(error);
    process.exitCode = 1;
  }
}

async function runSmoke(home: string): Promise<{
  productId: string;
  requirementId: string;
  designId: string;
  persistedPenPath: string;
  persistedPreviewPath: string;
  annotationCount: number;
  fetchedPreviewBytes: number;
}> {
  const store = createFormaStore({ home, bundledStylesDir: resolve("styles") });
  const pencil = new PencilService({ home });

  const styles = await store.styles.installBuiltInStyles();
  const style = styles.find((item) => item.name === "linear") ?? styles[0];
  invariant(style, "No built-in styles were installed");

  const createdProduct = await store.products.createProduct({
    name: "Pencil Smoke Mobile Login",
    description: "Temporary product for the real Pencil smoke test."
  });
  const product = await store.products.initProductConfig(createdProduct.id, {
    platform: "mobile",
    style
  });

  const components = await pencil.generateComponents({
    product_id: product.id,
    prompt: componentPrompt,
    workspace: home
  });
  await assertFileExists(components.penPath, "Generated components pen does not exist");
  await store.products.markComponentsInitialized(product.id);

  const emptyRequirement = await store.requirements.createEmptyRequirement(product.id, "Mobile Login");
  const requirement = await store.requirements.submitRequirement({
    requirement_id: emptyRequirement.id,
    document_md: `# Mobile Login\n\n${smokePrompt}\n`,
    pages: [
      {
        page_id: "login",
        name: "Login",
        baseline_page: "login",
        features: "Mobile authentication entry page",
        copy: "Title, email input, password input, login button, and forgot password link",
        fields: "email, password",
        interactions: "Submit credentials and open password recovery"
      }
    ],
    navigation: []
  });

  const pageDesign = await pencil.generatePageDesign({
    product_id: product.id,
    prompt: smokePrompt,
    workspace: components.tempDir
  });

  const [design] = await store.designs.saveDesigns(requirement.id, [
    {
      page_id: "login",
      penPath: pageDesign.penPath,
      previewPath: pageDesign.previewPath
    }
  ]);
  invariant(design, "Design persistence did not return a design");

  const persistedPenPath = designPath(home, design, "design.pen");
  const persistedPreviewPath = designPath(home, design, "preview@2x.png");
  await assertFileExists(persistedPenPath, "Persisted design.pen does not exist");
  await assertFileExists(persistedPreviewPath, "Persisted preview@2x.png does not exist");
  await assertPngFile(persistedPreviewPath, "Persisted preview@2x.png is not a PNG");

  await rm(components.tempDir, { recursive: true, force: true });
  await rm(pageDesign.tempDir, { recursive: true, force: true });

  const annotations = await store.designs.getDesignAnnotations(design.id);
  invariant(annotations.length > 0, "Persisted design has no annotations");

  const fetchedPreview = await fetchPreviewThroughServer(store, design.id);

  return {
    productId: product.id,
    requirementId: requirement.id,
    designId: design.id,
    persistedPenPath,
    persistedPreviewPath,
    annotationCount: annotations.length,
    fetchedPreviewBytes: fetchedPreview.length
  };
}

async function fetchPreviewThroughServer(store: ReturnType<typeof createFormaStore>, designId: string): Promise<Buffer> {
  const app = buildServer({ store });
  try {
    await app.ready();
    const response = await app.inject({
      method: "GET",
      url: `/api/designs/${encodeURIComponent(designId)}/image/file?version=1`
    });
    invariant(response.statusCode === 200, `Preview image route returned ${response.statusCode}`);
    invariant(headerIncludes(response.headers["content-type"], "image/png"), "Preview image route did not return image/png");
    invariant(hasPngSignature(response.rawPayload), "Preview image route did not return PNG bytes");
    return response.rawPayload;
  } finally {
    await app.close();
  }
}

function designPath(home: string, design: Design, filename: string): string {
  return join(home, "data", design.product_id, design.requirement_id, design.id, filename);
}

async function assertFileExists(filePath: string, message: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${message}: ${filePath}`);
  }
}

async function assertPngFile(filePath: string, message: string): Promise<void> {
  const bytes = await readFile(filePath);
  invariant(hasPngSignature(bytes), `${message}: ${filePath}`);
}

function hasPngSignature(value: Buffer): boolean {
  return (
    value.length >= 8 &&
    value[0] === 0x89 &&
    value[1] === 0x50 &&
    value[2] === 0x4e &&
    value[3] === 0x47 &&
    value[4] === 0x0d &&
    value[5] === 0x0a &&
    value[6] === 0x1a &&
    value[7] === 0x0a
  );
}

function headerIncludes(header: number | string | string[] | undefined, value: string): boolean {
  if (typeof header === "string") {
    return header.toLowerCase().includes(value);
  }
  if (Array.isArray(header)) {
    return header.some((item) => item.toLowerCase().includes(value));
  }
  return false;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureHomebrewPencilOnPath(): void {
  const homebrewBin = "/opt/homebrew/bin";
  const currentPath = process.env.PATH ?? "";
  if (!currentPath.split(":").includes(homebrewBin)) {
    process.env.PATH = `${homebrewBin}:${currentPath}`;
  }
}

function printError(error: unknown): void {
  if (error instanceof FormaError) {
    console.error(`FormaError ${error.code}: ${error.message}`);
    const details = safeFormaDetails(error.details);
    if (Object.keys(details).length > 0) {
      console.error(`details=${JSON.stringify(details)}`);
    }
    return;
  }

  if (error instanceof Error) {
    console.error(error.message);
    return;
  }

  console.error(String(error));
}

function safeFormaDetails(details: Record<string, unknown>): Record<string, string | number | boolean> {
  const safeKeys = new Set([
    "command",
    "exitCode",
    "reason",
    "file",
    "product_id",
    "requirement_id",
    "page_id",
    "design_id",
    "version",
    "mode",
    "status",
    "format"
  ]);
  return Object.fromEntries(
    Object.entries(details).filter(
      (entry): entry is [string, string | number | boolean] =>
        safeKeys.has(entry[0]) && ["string", "number", "boolean"].includes(typeof entry[1])
    )
  );
}

await main();
