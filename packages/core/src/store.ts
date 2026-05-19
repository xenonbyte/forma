import { randomBytes } from "node:crypto";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BaselineService } from "./baseline.js";
import { CopyService } from "./copy.js";
import { DesignService } from "./design.js";
import {
  deleteProductLocked,
  recoverPendingProductDeletesLocked,
  validateDeleteProductInput,
  type DeleteProductInput,
  type DeleteProductResult,
  type ProductDeletionHooks,
  type ProductDeletionRecoveryResult
} from "./product-deletion.js";
import { assertProductConfig, ProductService } from "./product.js";
import {
  defaultProductMutationWarningSink,
  getProductMutationLock,
  runProductMutationWithWarnings,
  type ProductMutationContext,
  type ProductMutationLock
} from "./product-mutation-lock.js";
import { RequirementService } from "./requirement.js";
import { SessionService } from "./session.js";
import { StyleService } from "./styles.js";
import {
  defaultPencilRunner,
  PencilService,
  type GeneratedComponentCandidate,
  type GeneratedDesign,
  type GenerateComponentsInput,
  type GeneratePageDesignInput
} from "./pencil.js";
import { SyncService } from "./sync.js";
import { FormaError } from "./errors.js";

export interface ComponentGenerator {
  generateComponents(input: GenerateComponentsInput): Promise<GeneratedComponentCandidate>;
}

export interface GeneratedComponents extends GeneratedComponentCandidate {
  libraryPath: string;
}

export interface PageDesignGenerator {
  generatePageDesign(input: GeneratePageDesignInput): Promise<GeneratedDesign>;
}

export interface GenerateAndSavePageDesignInput {
  product_id: string;
  requirement_id: string;
  page_id: string;
  prompt: string;
  workspace: string;
}

export interface GenerateAndSavePageDesignResult {
  product_id: string;
  requirement_id: string;
  page_id: string;
  design_id: string;
  version: number;
  pen_path: string;
  preview_path: string;
}

type GeneratedDesignCleanup = (tempDir: string) => Promise<void>;
type GeneratedDesignCleanupOutcome = "committed" | "failed";
type PageDesignSaveMode = "generate" | "refine" | "update";

export interface FormaStoreOptions {
  home: string;
  bundledStylesDir?: string;
  syncStyleLimit?: number;
  productMutationLock?: ProductMutationLock;
  onProductMutationWarning?: (warning: string) => void;
  pencilService?: ComponentGenerator;
  pageDesignGenerator?: PageDesignGenerator;
  generatedDesignCleanup?: GeneratedDesignCleanup;
  productDeletionHooks?: ProductDeletionHooks;
}

export function createFormaStore(options: FormaStoreOptions) {
  const productMutationLock = options.productMutationLock ?? getProductMutationLock(options.home);
  const onProductMutationWarning = options.onProductMutationWarning ?? defaultProductMutationWarningSink;
  const productMutationOptions = {
    productMutationLock,
    onProductMutationWarning: options.onProductMutationWarning
  };
  const pencil = new PencilService({ home: options.home, runner: defaultPencilRunner });
  const componentGenerator = options.pencilService ?? pencil;
  const pageDesignGenerator = options.pageDesignGenerator ?? pencil;
  const generatedDesignCleanup = options.generatedDesignCleanup ?? defaultGeneratedDesignCleanup;
  const styles = new StyleService({ home: options.home, bundledStylesDir: options.bundledStylesDir });
  const products = new ProductService({ home: options.home, ...productMutationOptions });
  const sessions = new SessionService({ home: options.home, products, ...productMutationOptions });
  const baseline = new BaselineService({ home: options.home, products, ...productMutationOptions });
  const copy = new CopyService({ home: options.home, ...productMutationOptions });
  const requirements = new RequirementService({ home: options.home, products, baseline, copy, ...productMutationOptions });
  const designs = new DesignService({ home: options.home, products, ...productMutationOptions });
  const sync = new SyncService({ home: options.home, pencilService: pencil, runner: defaultPencilRunner, styleLimit: options.syncStyleLimit });
  const runProductMutation = <T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>
  ): Promise<T> =>
    runProductMutationWithWarnings(
      productMutationLock,
      input,
      fn,
      onProductMutationWarning
    );
  const generateComponents = (input: GenerateComponentsInput): Promise<GeneratedComponents> =>
    runProductMutation({ operation: "generate_components", product_id: input.product_id }, async () => {
      const product = await products.getProduct(input.product_id);
      assertProductConfig(product, input.product_id, ["platform", "style", "languages"]);
      const candidate = await componentGenerator.generateComponents(input);
      const libraryPath = products.componentLibraryFile(input.product_id);
      try {
        await copyFileAtomic(candidate.penPath, libraryPath);
        return { ...candidate, libraryPath };
      } catch (error) {
        await rm(candidate.tempDir, { recursive: true, force: true });
        throw error;
      }
    });
  const generateAndSavePageDesign = (input: GenerateAndSavePageDesignInput): Promise<GenerateAndSavePageDesignResult> =>
    runProductMutation({ operation: "generate_and_save_page_design", product_id: input.product_id }, async (context) => {
      const product = await products.getProduct(input.product_id);
      assertProductConfig(product, input.product_id, ["platform", "style", "languages", "components_initialized"]);

      const requirement = await requirements.getRequirement({ requirement_id: input.requirement_id });
      if (requirement.product_id !== input.product_id) {
        throw new FormaError("PAGE_NOT_OWNED", "Requirement is not owned by product", {
          product_id: input.product_id,
          requirement_id: input.requirement_id,
          requirement_product_id: requirement.product_id
        });
      }

      const page = requirement.pages.find((candidate) => candidate.page_id === input.page_id);
      if (!page) {
        throw new FormaError("PAGE_NOT_OWNED", "Page is not owned by requirement", {
          product_id: input.product_id,
          requirement_id: input.requirement_id,
          page_id: input.page_id
        });
      }

      const mode = modeFromPageChangeType(page.change_type);
      const generated = await pageDesignGenerator.generatePageDesign({
        product_id: input.product_id,
        prompt: input.prompt,
        workspace: input.workspace
      });

      let committed = false;
      try {
        const savedDesigns = await designs.saveDesignsLocked(input.requirement_id, [
          { page_id: input.page_id, mode, penPath: generated.penPath, previewPath: generated.previewPath }
        ]);
        committed = true;

        const saved = savedDesigns.find((design) => design.page_id === input.page_id);
        if (!saved) {
          throw new FormaError("DESIGN_NOT_FOUND", "Saved design was not found", {
            requirement_id: input.requirement_id,
            page_id: input.page_id
          });
        }

        const metadata = await designs.getDesignMetadata(saved.id);
        await cleanupGeneratedDesignOutput(context, generatedDesignCleanup, generated.tempDir, "committed");
        return {
          product_id: input.product_id,
          requirement_id: input.requirement_id,
          page_id: input.page_id,
          design_id: saved.id,
          version: saved.version,
          pen_path: metadata.pen_path,
          preview_path: metadata.preview_path
        };
      } catch (error) {
        if (!committed) {
          await cleanupGeneratedDesignOutput(context, generatedDesignCleanup, generated.tempDir, "failed");
        }
        throw error;
      }
    });
  const deletionRuntime = { home: options.home, products, hooks: options.productDeletionHooks };
  const deleteProduct = async (input: DeleteProductInput): Promise<DeleteProductResult> => {
    const productId = validateDeleteProductInput(input);
    return runProductMutation({ operation: "delete_product", product_id: productId }, async (context) => {
      const result = await deleteProductLocked(deletionRuntime, input);
      return {
        ...result,
        recovery_warnings: [...result.recovery_warnings, ...context.warnings]
      };
    });
  };
  const recoverPendingProductDeletes = (): Promise<ProductDeletionRecoveryResult> =>
    runProductMutation({ operation: "recover_product_deletes" }, async (context) => {
      const result = await recoverPendingProductDeletesLocked(deletionRuntime);
      return {
        ...result,
        warnings: [...result.warnings, ...context.warnings]
      };
    });

  return {
    home: options.home,
    baseline,
    copy,
    deleteProduct,
    designs,
    generateComponents,
    generateAndSavePageDesign,
    products,
    recoverPendingProductDeletes,
    requirements,
    runProductMutation,
    sessions,
    sync,
    styles
  };
}

function modeFromPageChangeType(changeType: unknown): PageDesignSaveMode {
  if (changeType === "new") return "generate";
  if (changeType === "patch") return "refine";
  if (changeType === "rebuild") return "update";
  throw new FormaError("DESIGN_MODE_INVALID", "Design mode is invalid", { change_type: changeType });
}

async function cleanupGeneratedDesignOutput(
  context: ProductMutationContext,
  cleanup: GeneratedDesignCleanup,
  tempDir: string,
  outcome: GeneratedDesignCleanupOutcome
): Promise<void> {
  try {
    await cleanup(tempDir);
  } catch (error) {
    context.warnings.push(`Failed to cleanup generated design temp dir after ${outcome}: ${tempDir}: ${errorMessage(error)}`);
  }
}

async function defaultGeneratedDesignCleanup(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function copyFileAtomic(source: string, destination: string): Promise<void> {
  const parentDir = dirname(destination);
  await mkdir(parentDir, { recursive: true });
  const tempFile = join(parentDir, `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await copyFile(source, tempFile);
    await rename(tempFile, destination);
  } catch (error) {
    await rm(tempFile, { force: true });
    throw error;
  }
}
