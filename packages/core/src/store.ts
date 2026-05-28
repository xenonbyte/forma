import { randomBytes } from "node:crypto";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cleanupArtifactTmpDirs } from "./artifact-tmp-cleanup.js";
import { BaselineService } from "./baseline.js";
import { CopyService } from "./copy.js";
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
import { getProductComponentLibrary } from "./components.js";
import { getRequirementDesign } from "./requirement-design.js";
import { readDesignStartupRecoveryState } from "./design-session.js";
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
  type GenerateComponentsInput
} from "./pencil.js";
import { SyncService } from "./sync.js";
import { FormaError } from "./errors.js";
import { readSchemaNormalizationRecoveryState, SchemaNormalizationStartupError } from "./schema-normalization.js";
import { writeYamlAtomic } from "./yaml.js";
import { getFormaPaths } from "./paths.js";

export interface ComponentGenerator {
  generateComponents(input: GenerateComponentsInput): Promise<GeneratedComponentCandidate>;
}

export interface GeneratedComponents extends GeneratedComponentCandidate {
  libraryPath: string;
}

export interface FormaStoreOptions {
  home: string;
  bundledStylesDir?: string;
  syncStyleLimit?: number;
  productMutationLock?: ProductMutationLock;
  onProductMutationWarning?: (warning: string) => void;
  pencilService?: ComponentGenerator;
  productDeletionHooks?: ProductDeletionHooks;
}

export interface FormaStore {
  home: string;
  baseline: BaselineService;
  copy: CopyService;
  deleteProduct(input: DeleteProductInput): Promise<DeleteProductResult>;
  generateComponents(input: GenerateComponentsInput): Promise<GeneratedComponents>;
  products: ProductService;
  recoverPendingProductDeletes(): Promise<ProductDeletionRecoveryResult>;
  requirements: RequirementService;
  runProductMutation<T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>
  ): Promise<T>;
  sessions: SessionService;
  sync: SyncService;
  styles: StyleService;
}

export async function createFormaStore(options: FormaStoreOptions): Promise<FormaStore> {
  // Clean up stale .tmp-* artifact dirs (non-fatal on fs errors)
  cleanupArtifactTmpDirs(getFormaPaths(options.home).productsDir);

  const normalization = await readSchemaNormalizationRecoveryState(options.home);
  if (normalization.mode !== "normal") {
    throw new SchemaNormalizationStartupError(normalization);
  }
  const store = createStrictFormaStore(options);
  await validateStrictStoreReadModels(store);
  void readDesignStartupRecoveryState(options.home)
    .then((state) => writeYamlAtomic(join(options.home, "design-session-recovery-status.yaml"), {
      scanned_at: new Date().toISOString(),
      ...state
    }))
    .catch(() => undefined);
  return store;
}

function createStrictFormaStore(options: FormaStoreOptions): FormaStore {
  const productMutationLock = options.productMutationLock ?? getProductMutationLock(options.home);
  const onProductMutationWarning = options.onProductMutationWarning ?? defaultProductMutationWarningSink;
  const productMutationOptions = {
    productMutationLock,
    onProductMutationWarning: options.onProductMutationWarning
  };
  const pencil = new PencilService({ home: options.home, runner: defaultPencilRunner });
  const componentGenerator = options.pencilService ?? pencil;
  const styles = new StyleService({ home: options.home, bundledStylesDir: options.bundledStylesDir });
  const products = new ProductService({ home: options.home, ...productMutationOptions });
  const sessions = new SessionService({ home: options.home, products, ...productMutationOptions });
  const baseline = new BaselineService({ home: options.home, products, ...productMutationOptions });
  const copy = new CopyService({ home: options.home, ...productMutationOptions });
  const requirements = new RequirementService({ home: options.home, products, baseline, copy, ...productMutationOptions });
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
    Promise.reject(new FormaError("PENCIL_CAPABILITY_UNAVAILABLE", "Headless component generation is unavailable in v6", {
      product_id: input.product_id,
      required_mode: "app_bound_session"
    }));
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
    generateComponents,
    products,
    recoverPendingProductDeletes,
    requirements,
    runProductMutation,
    sessions,
    sync,
    styles
  };
}

async function validateStrictStoreReadModels(store: FormaStore): Promise<void> {
  const products = await store.products.listProducts();
  for (const productEntry of products) {
    const product = await store.products.getProduct(productEntry.id);
    const baseline = await store.baseline.getProductBaseline(product.id);
    void baseline;
    const componentLibrary = await getProductComponentLibrary(store.home, product.id);
    if (componentLibrary.status !== "missing" && componentLibrary.status !== "complete") {
      throw new FormaError("STRICT_SCHEMA_VALIDATION_FAILED", "Strict component library read model is invalid", {
        product_id: product.id,
        status: componentLibrary.status
      });
    }
    const requirements = await store.requirements.getRequirementHistory(product.id);
    for (const requirement of requirements) {
      await store.copy.getTranslations(product.id, requirement.id);
      const design = await getRequirementDesign(store.home, product.id, requirement.id);
      if (design.status === "invalid") {
        throw new FormaError("STRICT_SCHEMA_VALIDATION_FAILED", "Strict requirement design read model is invalid", {
          product_id: product.id,
          requirement_id: requirement.id,
          missing_files: design.missing_files,
          error: design.error
        });
      }
    }
  }
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
