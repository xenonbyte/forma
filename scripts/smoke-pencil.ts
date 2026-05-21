import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beginProductComponentSession, createFormaStore, discardProductComponentSession, FormaError } from "@xenonbyte/forma-core";
import { formatGenericErrorForLog } from "./smoke-pencil-error.js";

const smokePrompt =
  "Create a simple mobile login page with title, email input, password input, primary login button, and forgot password link. Use the product design style variables.";

async function main(): Promise<void> {
  ensureHomebrewPencilOnPath();

  const home = await mkdtemp(join(tmpdir(), "forma-pencil-smoke-"));
  try {
    const result = await runSmoke(home);
    console.log("Pencil smoke OK");
    console.log(`FORMA_HOME=${home}`);
    console.log(`product_id=${result.productId}`);
    console.log(`requirement_id=${result.requirementId}`);
    console.log(`component_session=${result.componentSessionId}`);
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
  componentSessionId: string;
}> {
  await writeFile(join(home, ".v6-schema-cutover-committed"), "committed\n", "utf8");
  const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });
  let componentSession: Awaited<ReturnType<typeof beginProductComponentSession>> | undefined;

  try {
    const styles = await store.styles.installBuiltInStyles();
    const style = styles.find((item) => item.name === "linear") ?? styles[0];
    invariant(style, "No built-in styles were installed");

    const createdProduct = await store.products.createProduct({
      name: "Pencil Smoke Mobile Login",
      description: "Temporary product for the real Pencil smoke test."
    });
    const product = await store.products.initProductConfig(createdProduct.id, {
      platform: "mobile",
      style,
      languages: ["en"],
      default_language: "en"
    });

    componentSession = await beginProductComponentSession({
      home,
      product_id: product.id,
      operation: "generate",
      newly_required_component_keys: ["input.text"],
      seed_components: [
        {
          component_key: "input.text",
          name: "Text input",
          semantic_contract_hash: "sha256:smoke-input-text",
          source: "smoke:pencil",
          required_by: []
        }
      ]
    });
    await assertFileExists(componentSession.staging_path, "Component staging pen does not exist");
    await discardProductComponentSession({ home, session_id: componentSession.session_id });
    const componentSessionId = componentSession.session_id;
    componentSession = undefined;

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
          copy: [{ context: "summary", text: "Title, email input, password input, login button, and forgot password link" }],
          fields: "email, password",
          interactions: "Submit credentials and open password recovery"
        }
      ],
      navigation: []
    });
    const persistedRequirement = await store.requirements.getRequirement({ requirement_id: requirement.id });
    invariant(persistedRequirement.document_md.includes(smokePrompt), "Persisted requirement document does not contain the smoke prompt");

    return {
      productId: product.id,
      requirementId: requirement.id,
      componentSessionId
    };
  } finally {
    if (componentSession) {
      await discardProductComponentSession({ home, session_id: componentSession.session_id }).catch((error: unknown) => {
        console.error(`cleanup_warning=${formatGenericErrorForLog(error)}`);
      });
    }
  }
}

async function assertFileExists(filePath: string, message: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${message}: ${filePath}`);
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureHomebrewPencilOnPath(): void {
  const preferredBins = ["/opt/homebrew/bin", "/usr/local/bin"];
  const currentPath = process.env.PATH ?? "";
  const currentEntries = currentPath.length > 0 ? currentPath.split(":") : [];
  const missingBins = preferredBins.filter((entry) => !currentEntries.includes(entry));
  if (missingBins.length > 0) {
    process.env.PATH = [...missingBins, ...currentEntries].join(":");
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

  console.error(formatGenericErrorForLog(error));
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
