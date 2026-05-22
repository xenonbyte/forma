import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  beginProductComponentSession,
  beginRequirementDesignSession,
  commitProductComponentSession,
  createFormaStore,
  discardRequirementDesignSession,
  FormaError,
  applyProductComponentOperations
} from "@xenonbyte/forma-core";
import { formatGenericErrorForLog } from "./smoke-pencil-error.js";

const componentKey = "input.text";
const smokePrompt =
  "Create a simple mobile login page with title, email input, password input, primary login button, and forgot password link. Use the product design style variables.";

async function main(): Promise<void> {
  ensureHomebrewPencilOnPath();
  console.log("Operator instruction: Open a non-Forma .pen in Pencil before running this smoke.");

  const home = await mkdtemp(join(tmpdir(), "forma-pencil-foreground-smoke-"));
  try {
    const result = await runSmoke(home);
    await rm(home, { recursive: true, force: true });
    console.log("Pencil foreground smoke OK");
    console.log(`FORMA_HOME=${home}`);
    console.log(`product_id=${result.productId}`);
    console.log(`requirement_id=${result.requirementId}`);
    console.log(`component_session=${result.componentSessionId}`);
    console.log(`requirement_session=${result.requirementSessionId}`);
    console.log("Manual confirmation: Pencil should have shown staging.lib.pen during component generation and staging.design.pen during requirement design.");
  } catch (error) {
    console.error("Pencil foreground smoke failed");
    console.error(`FORMA_HOME=${home}`);
    printError(error);
    process.exitCode = 1;
  }
}

async function runSmoke(home: string): Promise<{
  productId: string;
  requirementId: string;
  componentSessionId: string;
  requirementSessionId: string;
}> {
  await writeFile(join(home, ".v6-schema-cutover-committed"), "committed\n", "utf8");
  const store = await createFormaStore({ home, bundledStylesDir: resolve("styles") });

  const styles = await store.styles.installBuiltInStyles();
  const style = styles.find((item) => item.name === "linear") ?? styles[0];
  invariant(style, "No built-in styles were installed");

  const createdProduct = await store.products.createProduct({
    name: "Pencil Foreground Smoke Mobile Login",
    description: "Temporary product for the live Pencil foreground smoke test."
  });
  const product = await store.products.initProductConfig(createdProduct.id, {
    platform: "mobile",
    style,
    languages: ["en"],
    default_language: "en"
  });

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
        interactions: "Submit credentials and open password recovery",
        declared_component_keys: [componentKey]
      }
    ],
    navigation: []
  });

  await assertMissingComponentsBeforePencil(home, product.id, requirement.id);
  console.log("missing_components_check=ok");

  const componentSession = await beginProductComponentSession({
    home,
    product_id: product.id,
    operation: "generate",
    newly_required_component_keys: [componentKey],
    seed_components: [
      {
        component_key: componentKey,
        name: "Text input",
        semantic_contract_hash: `sha256:${"1".repeat(64)}`,
        source: "smoke:pencil:foreground",
        required_by: [{ requirement_id: requirement.id, page_id: "login" }]
      }
    ]
  });
  console.log(`component_staging=${componentSession.staging_path}`);

  await applyProductComponentOperations({
    home,
    session_id: componentSession.session_id,
    operations: [{ tool: "batch_design", args: { nodes: [] }, intent: "generate" }]
  });
  await commitProductComponentSession({ home, session_id: componentSession.session_id });

  const requirementSession = await beginRequirementDesignSession({
    home,
    product_id: product.id,
    requirement_id: requirement.id,
    operation: "generate"
  });
  console.log(`requirement_staging=${requirementSession.staging_path}`);
  await discardRequirementDesignSession({ home, session_id: requirementSession.session_id });

  return {
    productId: product.id,
    requirementId: requirement.id,
    componentSessionId: componentSession.session_id,
    requirementSessionId: requirementSession.session_id
  };
}

async function assertMissingComponentsBeforePencil(home: string, productId: string, requirementId: string): Promise<void> {
  try {
    await beginRequirementDesignSession({
      home,
      product_id: productId,
      requirement_id: requirementId,
      operation: "generate"
    });
  } catch (error) {
    if (error instanceof FormaError && error.details.required_action === "generate_components") {
      return;
    }
    throw error;
  }

  throw new Error("Expected requirement design session to require component generation before opening Pencil");
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
    console.error(`FormaError ${error.code}: ${formatGenericErrorForLog(error)}`);
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
    "cleanup_status",
    "command",
    "failed_phase",
    "pencil_version",
    "product_id",
    "reason",
    "required_action",
    "requirement_id",
    "session_id",
    "staging_path",
    "status"
  ]);
  return Object.fromEntries(
    Object.entries(details).filter(
      (entry): entry is [string, string | number | boolean] =>
        safeKeys.has(entry[0]) && ["string", "number", "boolean"].includes(typeof entry[1])
    )
  );
}

await main();
