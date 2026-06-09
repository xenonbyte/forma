import type { CraftDoc, BrandStyleContent, SystemStyleMetadata, StyleService } from "./styles.js";
import type { RequirementPage, StoredRule, RequirementService } from "./requirement.js";
import type { ProductService } from "./product.js";
import type { ArtifactStore } from "./artifact-store.js";
import type { ArtifactProductIcon } from "./artifact-manifest.js";
import { COMPONENT_BASELINES, type ComponentBaselineSpec, type ComponentPlatform } from "./component-baseline.js";

export interface DesignContextDeps {
  styles: StyleService;
  requirements: RequirementService;
  products: ProductService;
  /** Optional: when provided, componentLibrary is resolved via designSystemArtifactId pointer. */
  artifacts?: ArtifactStore;
}

export interface DesignContextInput {
  productId: string;
  requirementId: string;
  pageId?: string;
  brandStyle?: string;
  systemStyle?: string;
  craftSlugs?: string[];
}

/** Structured reference to the current component library (no inlined HTML). */
export interface ComponentLibraryRef {
  artifactId: string;
  version: number;
  productIcon?: ArtifactProductIcon;
}

export interface DesignContextResult {
  craft: CraftDoc[];
  brandStyle?: BrandStyleContent;
  systemStyle?: SystemStyleMetadata;
  page?: RequirementPage;
  rules: StoredRule[];
  platform?: string;
  language?: string;
  /** Platform-spec from COMPONENT_BASELINES. Always defined (falls back to "web" for desktop/tablet). */
  componentBaseline?: ComponentBaselineSpec;
  /**
   * Structured reference to the current component library.
   * Resolved via product.designSystemArtifactId + max version.
   * Undefined when designSystemArtifactId is unset. NEVER inlines HTML.
   */
  componentLibrary?: ComponentLibraryRef;
}

/**
 * Map a product platform string to one of the two supported ComponentPlatform values.
 * - "mobile" → "mobile"
 * - "web" | "desktop" | "tablet" | anything else → "web" (default; noted in SPEC-DATA-005)
 */
export function mapToComponentPlatform(platform: string | undefined): ComponentPlatform {
  if (platform === "mobile") return "mobile";
  // web, desktop, tablet, undefined → "web"
  return "web";
}

export async function buildDesignContext(
  deps: DesignContextDeps,
  input: DesignContextInput,
): Promise<DesignContextResult> {
  const { styles, requirements, products, artifacts } = deps;
  const { productId, requirementId, pageId } = input;

  // Load product, requirement, and rules concurrently
  const [product, req, allRules] = await Promise.all([
    products.getProduct(productId),
    requirements.getRequirement({ requirement_id: requirementId }),
    requirements.getProductRules(productId),
  ]);

  // craft: subset or all
  const craft: CraftDoc[] = input.craftSlugs
    ? await Promise.all(input.craftSlugs.map((s) => styles.readCraftDoc(s)))
    : await styles.listCraftDocs();

  // brandStyle: explicit > product.brand_style
  const brandStyleName = input.brandStyle ?? product.brand_style;
  const brandStyle = brandStyleName ? await styles.getStyle(brandStyleName) : undefined;

  // systemStyle: explicit > product.system_style
  const systemStyleName = input.systemStyle ?? product.system_style;
  const systemStyle = systemStyleName
    ? (await styles.listSystemStyles()).find((s) => s.name === systemStyleName)
    : undefined;

  // page
  const page = pageId ? req.pages.find((p) => p.page_id === pageId) : undefined;

  // rules: page-scoped + global when pageId given; otherwise all
  const rules = pageId ? allRules.filter((r) => r.page_id === pageId || r.page_id === undefined) : allRules;

  // platform and default_language from product
  const platform = product.platform;
  const language = product.default_language;

  // componentBaseline: always resolved from platform (falls back to "web" for desktop/tablet/unset)
  const componentPlatform = mapToComponentPlatform(platform);
  const componentBaseline = COMPONENT_BASELINES[componentPlatform];

  // componentLibrary: resolved via designSystemArtifactId pointer + max version.
  // Core returns the structural ref (no URLs — MCP layer enriches bundleUrl/previewUrl).
  let componentLibrary: ComponentLibraryRef | undefined;
  const dsArtifactId = product.designSystemArtifactId;
  if (dsArtifactId && artifacts) {
    const versions = await artifacts.listArtifactVersions(productId, dsArtifactId);
    if (versions.length > 0) {
      const version = Math.max(...versions);
      const { manifest } = await artifacts.readArtifactVersion(productId, dsArtifactId, version);
      componentLibrary = {
        artifactId: dsArtifactId,
        version,
        ...(manifest.forma?.productIcon !== undefined ? { productIcon: manifest.forma.productIcon } : {}),
      };
    }
  }

  return { craft, brandStyle, systemStyle, page, rules, platform, language, componentBaseline, componentLibrary };
}
