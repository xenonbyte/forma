import { cleanupArtifactTmpDirs, hasArtifactTmpDirs } from "./artifact-tmp-cleanup.js";
import { createArtifactStore, type ArtifactStore } from "./artifact-store.js";
import { CopyService } from "./copy.js";
import { saveDesignArtifact } from "./design-save.js";
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

export interface GenerateRequirementDesignInput {
  html: string;
  title: string;
  pageId: string;
  variant?: string;
  brandStyle?: string;
  systemStyle?: string;
  platform?: string;
  language?: string;
  provenance?: import("./artifact-manifest.js").ArtifactProvenance;
}

export interface GenerateComponentsInput {
  html: string;
  title: string;
  brandStyle?: string;
  systemStyle?: string;
  platform?: string;
  language?: string;
  provenance?: import("./artifact-manifest.js").ArtifactProvenance;
}

export interface ChangeArtifactStyleInput {
  html: string;
  title: string;
  brandStyle?: string;
  systemStyle?: string;
  platform?: string;
  language?: string;
  provenance?: import("./artifact-manifest.js").ArtifactProvenance;
}

export interface FormaStore {
  home: string;
  artifacts: ArtifactStore;
  copy: CopyService;
  deleteProduct(input: DeleteProductInput): Promise<DeleteProductResult>;
  generateRequirementDesign(
    productId: string,
    requirementId: string,
    input: GenerateRequirementDesignInput
  ): Promise<{ artifact_id: string; version: number; preview_status: string }>;
  generateComponents(
    productId: string,
    input: GenerateComponentsInput
  ): Promise<{ artifact_id: string; version: number; preview_status: string }>;
  changeArtifactStyle(
    productId: string,
    artifactId: string,
    input: ChangeArtifactStyleInput
  ): Promise<{ artifact_id: string; version: number; preview_status: string }>;
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

  const productsRoot = getFormaPaths(options.home).productsDir;
  const saveDesignDeps = { artifacts, products, runProductMutation, productsRoot };

  async function generateRequirementDesign(
    productId: string,
    requirementId: string,
    input: GenerateRequirementDesignInput
  ): Promise<{ artifact_id: string; version: number; preview_status: string }> {
    const result = await saveDesignArtifact(saveDesignDeps, {
      productId,
      kind: 'design-page',
      html: input.html,
      title: input.title,
      forma: {
        requirementId,
        pageId: input.pageId,
        variant: input.variant,
        brandStyle: input.brandStyle,
        systemStyle: input.systemStyle,
        platform: input.platform,
        language: input.language,
        provenance: input.provenance,
      },
    });
    return { artifact_id: result.artifactId, version: result.version, preview_status: result.previewStatus };
  }

  async function generateComponents(
    productId: string,
    input: GenerateComponentsInput
  ): Promise<{ artifact_id: string; version: number; preview_status: string }> {
    const result = await saveDesignArtifact(saveDesignDeps, {
      productId,
      kind: 'component-library',
      html: input.html,
      title: input.title,
      forma: {
        brandStyle: input.brandStyle,
        systemStyle: input.systemStyle,
        platform: input.platform,
        language: input.language,
        provenance: input.provenance,
      },
    });
    return { artifact_id: result.artifactId, version: result.version, preview_status: result.previewStatus };
  }

  async function changeArtifactStyle(
    productId: string,
    artifactId: string,
    input: ChangeArtifactStyleInput
  ): Promise<{ artifact_id: string; version: number; preview_status: string }> {
    // Read source artifact's latest version manifest to recover kind/forma
    const versions = await artifacts.listArtifactVersions(productId, artifactId);
    if (versions.length === 0) {
      // Fall back to flat artifact read for legacy artifacts
      const { manifest: sourceManifest } = await artifacts.readArtifact(productId, artifactId);
      return changeArtifactStyleWithManifest(productId, artifactId, input, sourceManifest);
    }
    const latestVersion = Math.max(...versions);
    const { manifest: sourceManifest } = await artifacts.readArtifactVersion(productId, artifactId, latestVersion);
    return changeArtifactStyleWithManifest(productId, artifactId, input, sourceManifest);
  }

  async function changeArtifactStyleWithManifest(
    productId: string,
    artifactId: string,
    input: ChangeArtifactStyleInput,
    sourceManifest: import("./artifact-manifest.js").ArtifactManifest,
  ): Promise<{ artifact_id: string; version: number; preview_status: string }> {

    // Determine kind: map legacy kinds to new ones
    let kind: 'design-page' | 'component-library';
    if (sourceManifest.kind === 'design-page' || sourceManifest.kind === 'html') {
      kind = 'design-page';
    } else {
      kind = 'component-library';
    }

    const sourceForma = sourceManifest.forma ?? {};
    const result = await saveDesignArtifact(saveDesignDeps, {
      productId,
      kind,
      html: input.html,
      title: input.title,
      artifactId, // same artifactId → new version
      forma: {
        requirementId: sourceForma.requirementId ?? sourceManifest.requirementId,
        pageId: sourceForma.pageId,
        variant: sourceForma.variant,
        brandStyle: input.brandStyle ?? sourceForma.brandStyle,
        systemStyle: input.systemStyle ?? sourceForma.systemStyle,
        platform: input.platform ?? sourceForma.platform,
        language: input.language ?? sourceForma.language,
        provenance: input.provenance,
      },
    });
    return { artifact_id: result.artifactId, version: result.version, preview_status: result.previewStatus };
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
