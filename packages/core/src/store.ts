import { cleanupArtifactTmpDirs, hasArtifactTmpDirs } from "./artifact-tmp-cleanup.js";
import { createArtifactStore, type ArtifactStore } from "./artifact-store.js";
import { type ArtifactKind } from "./artifact-manifest.js";
import { CopyService } from "./copy.js";
import { createOdRuntime } from "./od-runtime.js";
import {
  deleteProductLocked,
  recoverPendingProductDeletesLocked,
  validateDeleteProductInput,
  type DeleteProductInput,
  type DeleteProductResult,
  type ProductDeletionHooks,
  type ProductDeletionRecoveryResult
} from "./product-deletion.js";
import { ProductService } from "./product.js";
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
import { readSchemaNormalizationRecoveryState, SchemaNormalizationStartupError } from "./schema-normalization.js";
import { getFormaPaths } from "./paths.js";

export interface FormaStoreOptions {
  home: string;
  bundledStylesDir?: string;
  bundledCraftDir?: string;
  productMutationLock?: ProductMutationLock;
  onProductMutationWarning?: (warning: string) => void;
  artifactStore?: ArtifactStore;
  productDeletionHooks?: ProductDeletionHooks;
}

export interface SeedComponent {
  name: string;
  description?: string;
}

export interface FormaStore {
  home: string;
  artifacts: ArtifactStore;
  copy: CopyService;
  deleteProduct(input: DeleteProductInput): Promise<DeleteProductResult>;
  generateRequirementDesign(
    productId: string,
    requirementId: string,
    mode: "generate" | "rebuild",
    sourceSkillId?: string
  ): Promise<{ artifact_id: string; preview_url: string }>;
  generateComponents(
    productId: string,
    seedComponents: SeedComponent[],
    sourceSkillId?: string
  ): Promise<{ artifact_id: string; preview_url: string }>;
  changeArtifactStyle(
    productId: string,
    artifactId: string,
    style: string,
    sourceSkillId?: string
  ): Promise<{ artifact_id: string; preview_url: string }>;
  products: ProductService;
  recoverPendingProductDeletes(): Promise<ProductDeletionRecoveryResult>;
  requirements: RequirementService;
  runProductMutation<T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>
  ): Promise<T>;
  sessions: SessionService;
  styles: StyleService;
}

export async function createFormaStore(options: FormaStoreOptions): Promise<FormaStore> {
  const productMutationLock = options.productMutationLock ?? getProductMutationLock(options.home);
  const productsDir = getFormaPaths(options.home).productsDir;

  if (hasArtifactTmpDirs(productsDir)) {
    await productMutationLock.run({ operation: "cleanup_artifact_tmp_dirs" }, async () => {
      cleanupArtifactTmpDirs(productsDir);
    });
  }

  const normalization = await readSchemaNormalizationRecoveryState(options.home);
  if (normalization.mode !== "normal") {
    throw new SchemaNormalizationStartupError(normalization);
  }
  const store = createStrictFormaStore({ ...options, productMutationLock });
  await validateStrictStoreReadModels(store);
  return store;
}

function createStrictFormaStore(options: FormaStoreOptions): FormaStore {
  const productMutationLock = options.productMutationLock ?? getProductMutationLock(options.home);
  const onProductMutationWarning = options.onProductMutationWarning ?? defaultProductMutationWarningSink;
  const productMutationOptions = {
    productMutationLock,
    onProductMutationWarning: options.onProductMutationWarning
  };
  const styles = new StyleService({ home: options.home, bundledStylesDir: options.bundledStylesDir, bundledCraftDir: options.bundledCraftDir });
  const products = new ProductService({ home: options.home, ...productMutationOptions });
  const sessions = new SessionService({ home: options.home, products, ...productMutationOptions });
  const copy = new CopyService({ home: options.home, ...productMutationOptions });
  const requirements = new RequirementService({ home: options.home, products, copy, ...productMutationOptions });
  const artifacts = options.artifactStore ?? createArtifactStore(getFormaPaths(options.home).productsDir, productMutationLock);
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

  function artifactPreviewUrl(productId: string, artifactId: string): string {
    return `/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}/preview/2x`;
  }

  async function generateRequirementDesign(
    productId: string,
    requirementId: string,
    mode: "generate" | "rebuild",
    sourceSkillId?: string
  ): Promise<{ artifact_id: string; preview_url: string }> {
    const odRuntime = createOdRuntime();
    const output = await odRuntime.generate({
      kind: "html" as ArtifactKind,
      requirementId,
      sourceSkillId: sourceSkillId ?? "fm-design",
      ignoreInternalCache: mode === "rebuild"
    });
    const { artifactId } = await artifacts.writeArtifact({
      productId,
      manifest: { ...output.manifest, requirementId, sourceSkillId },
      files: new Map(
        [...output.supportingFiles].map(([k, v]) => [k, Buffer.from(v)])
      )
    });
    return { artifact_id: artifactId, preview_url: artifactPreviewUrl(productId, artifactId) };
  }

  async function generateComponents(
    productId: string,
    seedComponents: SeedComponent[],
    sourceSkillId?: string
  ): Promise<{ artifact_id: string; preview_url: string }> {
    const odRuntime = createOdRuntime();
    const instructions = seedComponents
      .map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`)
      .join("\n");
    const output = await odRuntime.generate({
      kind: "design-system" as ArtifactKind,
      instructions,
      sourceSkillId: sourceSkillId ?? "fm-refine-components"
    });
    const { artifactId } = await artifacts.writeArtifact({
      productId,
      manifest: { ...output.manifest, sourceSkillId },
      files: new Map(
        [...output.supportingFiles].map(([k, v]) => [k, Buffer.from(v)])
      )
    });
    return { artifact_id: artifactId, preview_url: artifactPreviewUrl(productId, artifactId) };
  }

  async function changeArtifactStyle(
    productId: string,
    artifactId: string,
    style: string,
    sourceSkillId?: string
  ): Promise<{ artifact_id: string; preview_url: string }> {
    const { manifest: sourceManifest } = await artifacts.readArtifact(productId, artifactId);
    const odRuntime = createOdRuntime();
    const output = await odRuntime.generate({
      kind: sourceManifest.kind,
      requirementId: sourceManifest.requirementId,
      style,
      sourceSkillId: sourceSkillId ?? "fm-change-style"
    });
    const { artifactId: newArtifactId } = await artifacts.writeArtifact({
      productId,
      manifest: { ...output.manifest, requirementId: sourceManifest.requirementId, sourceSkillId },
      files: new Map(
        [...output.supportingFiles].map(([k, v]) => [k, Buffer.from(v)])
      )
    });
    return { artifact_id: newArtifactId, preview_url: artifactPreviewUrl(productId, newArtifactId) };
  }

  return {
    home: options.home,
    artifacts,
    copy,
    deleteProduct,
    generateRequirementDesign,
    generateComponents,
    changeArtifactStyle,
    products,
    recoverPendingProductDeletes,
    requirements,
    runProductMutation,
    sessions,
    styles
  };
}

async function validateStrictStoreReadModels(store: FormaStore): Promise<void> {
  const products = await store.products.listProducts();
  for (const productEntry of products) {
    await store.products.getProduct(productEntry.id);
    const requirements = await store.requirements.getRequirementHistory(productEntry.id);
    for (const requirement of requirements) {
      await store.copy.getTranslations(productEntry.id, requirement.id);
    }
  }
}
