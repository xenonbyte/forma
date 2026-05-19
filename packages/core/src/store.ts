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
import { defaultPencilRunner, PencilService, type GeneratedComponentCandidate, type GenerateComponentsInput } from "./pencil.js";
import { SyncService } from "./sync.js";

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

export function createFormaStore(options: FormaStoreOptions) {
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
    products,
    recoverPendingProductDeletes,
    requirements,
    runProductMutation,
    sessions,
    sync,
    styles
  };
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
