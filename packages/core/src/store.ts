import { cleanupArtifactTmpDirs, hasArtifactTmpDirs } from "./artifact-tmp-cleanup.js";
import { createArtifactStore, type ArtifactStore } from "./artifact-store.js";
import { CopyService } from "./copy.js";
import { saveDesignArtifact } from "./design-save.js";
import { FormaError } from "./errors.js";
import {
  deleteProductLocked,
  recoverPendingProductDeletesLocked,
  validateDeleteProductInput,
  type DeleteProductInput,
  type DeleteProductResult,
  type ProductDeletionHooks,
  type ProductDeletionRecoveryResult,
} from "./product-deletion.js";
import { ProductService } from "./product.js";
import {
  defaultProductMutationWarningSink,
  getProductMutationLock,
  runProductMutationWithWarnings,
  type ProductMutationContext,
  type ProductMutationLock,
} from "./product-mutation-lock.js";
import { RequirementService, type RequirementWithDocument, type StoredRule } from "./requirement.js";
import { SessionService } from "./session.js";
import { StyleService } from "./styles.js";
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
  html?: string;
  title: string;
  brandStyle?: string;
  systemStyle?: string;
  platform?: string;
  language?: string;
  provenance?: import("./artifact-manifest.js").ArtifactProvenance;
  /** Product icon metadata (SPEC-DATA-001). When provided, supportingFiles must include the referenced SVG assets. */
  productIcon?: import("./artifact-manifest.js").ArtifactProductIcon;
  /** Caller-supplied supporting files (e.g. product icon SVGs) mapped into the artifact bundle. */
  supportingFiles?: import("./design-save.js").SupportingFileInput[];
  /** Shared CSS variable definitions for a decomposed component library. */
  tokensCss?: string;
  /** Per-unit component definitions for a decomposed component library. */
  units?: import("./design-save.js").ComponentUnitInput[];
}

export interface FormaStore {
  home: string;
  artifacts: ArtifactStore;
  copy: CopyService;
  deleteProduct(input: DeleteProductInput): Promise<DeleteProductResult>;
  generateRequirementDesign(
    productId: string,
    requirementId: string,
    input: GenerateRequirementDesignInput,
  ): Promise<{ artifact_id: string; version: number; preview_status: string }>;
  generateComponents(
    productId: string,
    input: GenerateComponentsInput,
  ): Promise<{ artifact_id: string; version: number; preview_status: string }>;
  products: ProductService;
  recoverPendingProductDeletes(): Promise<ProductDeletionRecoveryResult>;
  requirements: RequirementService;
  runProductMutation<T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>,
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

  const store = createStrictFormaStore({ ...options, productMutationLock });
  await validateStrictStoreReadModels(store);
  return store;
}

export function createStrictFormaStore(options: FormaStoreOptions): FormaStore {
  const productMutationLock = options.productMutationLock ?? getProductMutationLock(options.home);
  const onProductMutationWarning = options.onProductMutationWarning ?? defaultProductMutationWarningSink;
  const productMutationOptions = {
    productMutationLock,
    onProductMutationWarning: options.onProductMutationWarning,
  };
  const styles = new StyleService({
    home: options.home,
    bundledStylesDir: options.bundledStylesDir,
    bundledCraftDir: options.bundledCraftDir,
  });
  const products = new ProductService({ home: options.home, ...productMutationOptions });
  const sessions = new SessionService({ home: options.home, products, ...productMutationOptions });
  const copy = new CopyService({ home: options.home, ...productMutationOptions });
  const requirements = new RequirementService({ home: options.home, products, copy, ...productMutationOptions });
  const artifacts =
    options.artifactStore ?? createArtifactStore(getFormaPaths(options.home).productsDir, productMutationLock);
  const runProductMutation = <T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>,
  ): Promise<T> => runProductMutationWithWarnings(productMutationLock, input, fn, onProductMutationWarning);
  const deletionRuntime = { home: options.home, products, hooks: options.productDeletionHooks };
  const deleteProduct = async (input: DeleteProductInput): Promise<DeleteProductResult> => {
    const productId = validateDeleteProductInput(input);
    return runProductMutation({ operation: "delete_product", product_id: productId }, async (context) => {
      const result = await deleteProductLocked(deletionRuntime, input);
      return {
        ...result,
        recovery_warnings: [...result.recovery_warnings, ...context.warnings],
      };
    });
  };
  const recoverPendingProductDeletes = (): Promise<ProductDeletionRecoveryResult> =>
    runProductMutation({ operation: "recover_product_deletes" }, async (context) => {
      const result = await recoverPendingProductDeletesLocked(deletionRuntime);
      return {
        ...result,
        warnings: [...result.warnings, ...context.warnings],
      };
    });

  const productsRoot = getFormaPaths(options.home).productsDir;
  const saveDesignDeps = { artifacts, products, runProductMutation, productsRoot };

  async function generateRequirementDesign(
    productId: string,
    requirementId: string,
    input: GenerateRequirementDesignInput,
  ): Promise<{ artifact_id: string; version: number; preview_status: string }> {
    // Validate the requirement belongs to this product and the page exists before
    // writing an artifact / design pointer — otherwise a typo page_id or a
    // foreign requirement_id would persist a pointer to a nonexistent page.
    const requirement = await requirements.getRequirement({ requirement_id: requirementId });
    if (requirement.product_id !== productId) {
      throw new FormaError("REQUIREMENT_PRODUCT_MISMATCH", "Requirement does not belong to product", {
        product_id: productId,
        requirement_id: requirementId,
        requirement_product_id: requirement.product_id,
      });
    }
    assertRequirementAcceptsDesignCommit(requirement);
    if (!requirement.pages.some((page) => page.page_id === input.pageId)) {
      throw new FormaError("REQUIREMENT_PAGE_NOT_FOUND", "Requirement page not found", {
        product_id: productId,
        requirement_id: requirementId,
        page_id: input.pageId,
      });
    }
    const rules = await requirements.getProductRules(productId);

    const variant = input.variant ?? "default";
    const existingPointer = await products.getDesignPointer(productId, requirementId, input.pageId, variant);
    const result = await saveDesignArtifact(saveDesignDeps, {
      productId,
      kind: "design-page",
      html: input.html,
      title: input.title,
      artifactId: existingPointer?.artifactId,
      forma: {
        requirementId,
        pageId: input.pageId,
        variant,
        brandStyle: input.brandStyle,
        systemStyle: input.systemStyle,
        platform: input.platform,
        language: input.language,
        provenance: input.provenance,
      },
      commitHooks: {
        beforeWriteLocked: async () => {
          const [current, currentRules] = await Promise.all([
            requirements.getRequirement({ requirement_id: requirementId }),
            requirements.getProductRules(productId),
          ]);
          assertSameRequirementRevision(requirement, rules, current, currentRules, input.pageId);
        },
        afterPointerLocked: async () => {
          await requirements.markPageDesignDoneLocked(requirementId, input.pageId);
        },
      },
    });
    return { artifact_id: result.artifactId, version: result.version, preview_status: result.previewStatus };
  }

  async function generateComponents(
    productId: string,
    input: GenerateComponentsInput,
  ): Promise<{ artifact_id: string; version: number; preview_status: string }> {
    // Pointer is the single source of truth for the current component library.
    // Re-check it inside the artifact write lock so concurrent first refines do
    // not each create their own v1 artifact. If the pointer changed while this
    // save rendered its preview, retry against the current pointer.
    let expectedArtifactId = (await products.getProduct(productId)).designSystemArtifactId;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await saveDesignArtifact(saveDesignDeps, {
          productId,
          kind: "component-library",
          ...(input.html !== undefined ? { html: input.html } : {}),
          ...(input.tokensCss !== undefined ? { tokensCss: input.tokensCss } : {}),
          ...(input.units !== undefined ? { units: input.units } : {}),
          title: input.title,
          ...(expectedArtifactId !== undefined ? { artifactId: expectedArtifactId } : {}),
          forma: {
            brandStyle: input.brandStyle,
            systemStyle: input.systemStyle,
            platform: input.platform,
            language: input.language,
            provenance: input.provenance,
            ...(input.productIcon !== undefined ? { productIcon: input.productIcon } : {}),
          },
          ...(input.supportingFiles !== undefined ? { supportingFiles: input.supportingFiles } : {}),
          commitHooks: {
            beforeWriteLocked: async () => {
              const currentArtifactId = (await products.getProduct(productId)).designSystemArtifactId;
              if (currentArtifactId !== expectedArtifactId) {
                throw new ComponentLibraryPointerChanged(currentArtifactId);
              }
            },
          },
        });
        return { artifact_id: result.artifactId, version: result.version, preview_status: result.previewStatus };
      } catch (error) {
        if (!(error instanceof ComponentLibraryPointerChanged)) {
          throw error;
        }
        expectedArtifactId = error.artifactId;
      }
    }
    throw new FormaError("ARTIFACT_WRITE_FAIL", "Component library pointer changed too many times", {
      product_id: productId,
    });
  }

  return {
    home: options.home,
    artifacts,
    copy,
    deleteProduct,
    generateRequirementDesign,
    generateComponents,
    products,
    recoverPendingProductDeletes,
    requirements,
    runProductMutation,
    sessions,
    styles,
  };
}

class ComponentLibraryPointerChanged extends Error {
  constructor(readonly artifactId: string | undefined) {
    super("Component library pointer changed during artifact write");
  }
}

function assertRequirementAcceptsDesignCommit(requirement: RequirementWithDocument): void {
  if (requirement.status !== "submitted" && requirement.status !== "active") {
    throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
      requirement_id: requirement.id,
      status: requirement.status,
    });
  }
}

function assertSameRequirementRevision(
  expected: RequirementWithDocument,
  expectedRules: StoredRule[],
  current: RequirementWithDocument,
  currentRules: StoredRule[],
  pageId: string,
): void {
  assertRequirementAcceptsDesignCommit(current);
  if (
    JSON.stringify(toDesignCommitRevision(expected, expectedRules, pageId)) ===
    JSON.stringify(toDesignCommitRevision(current, currentRules, pageId))
  ) {
    return;
  }

  const expectedPage = expected.pages.find((page) => page.page_id === pageId);
  const currentPage = current.pages.find((page) => page.page_id === pageId);
  const expectedDesignRules = filterDesignContextRules(expectedRules, pageId);
  const currentDesignRules = filterDesignContextRules(currentRules, pageId);
  throw new FormaError("REQUIREMENT_REVISION_CONFLICT", "Requirement changed before design save completed", {
    requirement_id: expected.id,
    page_id: pageId,
    expected_updated_at: expected.updated_at,
    current_updated_at: current.updated_at,
    expected_status: expected.status,
    current_status: current.status,
    expected_page_design_status: expectedPage?.design_status,
    current_page_design_status: currentPage?.design_status,
    expected_rule_ids: expectedDesignRules.map((rule) => rule.id),
    current_rule_ids: currentDesignRules.map((rule) => rule.id),
  });
}

function toDesignCommitRevision(requirement: RequirementWithDocument, rules: StoredRule[], pageId: string): unknown {
  const { status: _status, updated_at: _updatedAt, pages, ...revision } = requirement;
  return {
    ...revision,
    rules: filterDesignContextRules(rules, pageId),
    pages: pages.map((page) => {
      if (page.page_id === pageId) {
        return page;
      }
      const { design_status: _designStatus, ...pageRevision } = page;
      return pageRevision;
    }),
  };
}

function filterDesignContextRules(rules: StoredRule[], pageId: string): StoredRule[] {
  return rules.filter((rule) => rule.page_id === pageId || rule.page_id === undefined);
}

// Strict-by-default startup contract: the store refuses to come up if ANY
// product's read models (product.yaml, requirement history, copy translations)
// fail to load. This is intentional — it surfaces on-disk corruption (including
// any non-v6 legacy layout) loudly rather than serving partial/inconsistent
// data. We do NOT degrade to "skip the bad product" here; changing that is a
// deliberate product decision, not a bug fix.
//
// We do, however, attribute the failure to the offending product so the crash
// log points at it instead of an opaque parse error.
async function validateStrictStoreReadModels(store: FormaStore): Promise<void> {
  const products = await store.products.listProducts();
  for (const productEntry of products) {
    try {
      await store.products.getProduct(productEntry.id);
      const requirements = await store.requirements.getRequirementHistory(productEntry.id);
      for (const requirement of requirements) {
        await store.copy.getTranslations(productEntry.id, requirement.id);
      }
    } catch (error) {
      throw attributeStartupValidationError(error, productEntry.id);
    }
  }
}

function attributeStartupValidationError(error: unknown, productId: string): FormaError {
  if (error instanceof FormaError) {
    if (error.details.product_id === productId) {
      return error;
    }
    return new FormaError(error.code, error.message, { ...error.details, product_id: productId });
  }
  return new FormaError(
    "STRICT_SCHEMA_VALIDATION_FAILED",
    `Startup read-model validation failed for product ${productId}`,
    { product_id: productId, cause: error instanceof Error ? error.message : String(error) },
  );
}
