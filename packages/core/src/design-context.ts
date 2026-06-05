import type { CraftDoc, BrandStyleContent, SystemStyleMetadata, StyleService } from "./styles.js";
import type { RequirementPage, StoredRule, RequirementService } from "./requirement.js";
import type { ProductService } from "./product.js";

export interface DesignContextDeps {
  styles: StyleService;
  requirements: RequirementService;
  products: ProductService;
}

export interface DesignContextInput {
  productId: string;
  requirementId: string;
  pageId?: string;
  brandStyle?: string;
  systemStyle?: string;
  craftSlugs?: string[];
}

export interface DesignContextResult {
  craft: CraftDoc[];
  brandStyle?: BrandStyleContent;
  systemStyle?: SystemStyleMetadata;
  page?: RequirementPage;
  rules: StoredRule[];
  platform?: string;
  language?: string;
}

export async function buildDesignContext(
  deps: DesignContextDeps,
  input: DesignContextInput,
): Promise<DesignContextResult> {
  const { styles, requirements, products } = deps;
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

  return { craft, brandStyle, systemStyle, page, rules, platform, language };
}
