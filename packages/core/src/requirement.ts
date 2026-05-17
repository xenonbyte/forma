import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { BaselineService, baselineNavigationSchema } from "./baseline.js";
import { FormaError } from "./errors.js";
import { createId } from "./ids.js";
import type { ProductService } from "./product.js";
import { requirementStatuses, designStatuses } from "./schemas.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const requirementIdSchema = z.string().regex(/^R-[a-f0-9]{8}$/);

export const requirementPageSchema = z.object({
  page_id: z.string().min(1),
  name: z.string().min(1),
  baseline_page: z.string().min(1),
  design_status: z.enum(designStatuses),
  features: z.string().optional(),
  copy: z.string().optional(),
  fields: z.string().optional(),
  interactions: z.string().optional()
}).strict();

export const requirementSchema = z.object({
  id: requirementIdSchema,
  product_id: z.string().regex(/^P-[a-f0-9]{6}$/),
  title: z.string().min(1),
  status: z.enum(requirementStatuses),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  pages: z.array(requirementPageSchema),
  navigation: z.array(baselineNavigationSchema)
}).strict();

export type RequirementPage = z.infer<typeof requirementPageSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type RequirementWithDocument = Requirement & { document_md: string };

export interface SubmitRequirementInput {
  requirement_id: string;
  document_md: string;
  pages: Array<Omit<RequirementPage, "design_status"> & { design_status?: RequirementPage["design_status"] }>;
  navigation: z.infer<typeof baselineNavigationSchema>[];
}

export interface UpdateRequirementInput extends SubmitRequirementInput {
  expired_pages: string[];
}

export interface RequirementServiceOptions {
  home: string;
  products: ProductService;
  baseline: BaselineService;
}

export class RequirementService {
  private readonly dataDir: string;
  private readonly products: ProductService;
  private readonly baseline: BaselineService;

  constructor(options: RequirementServiceOptions) {
    this.dataDir = join(options.home, "data");
    this.products = options.products;
    this.baseline = options.baseline;
  }

  async createEmptyRequirement(productId: string, title: string): Promise<Requirement> {
    await this.products.getProduct(productId);

    const now = new Date().toISOString();
    const requirement = requirementSchema.parse({
      id: createId("requirement"),
      product_id: productId,
      title,
      status: "empty",
      created_at: now,
      updated_at: now,
      pages: [],
      navigation: []
    });

    await writeYamlAtomic(this.requirementFile(requirement.product_id, requirement.id), requirement);
    return requirement;
  }

  async submitRequirement(input: SubmitRequirementInput): Promise<Requirement> {
    const current = await this.readRequirementById(input.requirement_id);
    if (current.status !== "empty") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: input.requirement_id,
        status: current.status
      });
    }
    assertDocument(input.document_md);
    assertPages(input.pages);

    const pages = input.pages.map((page) => requirementPageSchema.parse({ ...page, design_status: "pending" }));
    const next = requirementSchema.parse({
      ...current,
      status: "submitted",
      updated_at: new Date().toISOString(),
      pages,
      navigation: input.navigation
    });

    await this.baseline.updateFromRequirement({
      productId: next.product_id,
      requirementId: next.id,
      pages: next.pages,
      navigation: mapNavigationToBaseline(next.pages, next.navigation)
    });
    await writeDocumentAtomic(this.documentFile(next.product_id, next.id), input.document_md);
    await writeYamlAtomic(this.requirementFile(next.product_id, next.id), next);

    return next;
  }

  async updateRequirement(input: UpdateRequirementInput): Promise<Requirement> {
    const current = await this.readRequirementById(input.requirement_id);
    if (current.status !== "submitted" && current.status !== "active") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: input.requirement_id,
        status: current.status
      });
    }
    assertDocument(input.document_md);
    assertPages(input.pages);

    const currentPagesById = new Map(current.pages.map((page) => [page.page_id, page]));
    const expiredIds = new Set(input.expired_pages);
    const nextActivePages = input.pages.map((page) => {
      const currentPage = currentPagesById.get(page.page_id);
      const designStatus = expiredIds.has(page.page_id) ? "expired" : (currentPage?.design_status ?? "pending");
      return requirementPageSchema.parse({ ...page, design_status: designStatus });
    });
    const nextActiveIds = new Set(nextActivePages.map((page) => page.page_id));
    const expiredPages = current.pages
      .filter((page) => expiredIds.has(page.page_id) && !nextActiveIds.has(page.page_id))
      .map((page) => requirementPageSchema.parse({ ...page, design_status: "expired" }));

    const next = requirementSchema.parse({
      ...current,
      updated_at: new Date().toISOString(),
      pages: [...nextActivePages, ...expiredPages],
      navigation: input.navigation
    });

    await this.baseline.updateFromRequirement({
      productId: next.product_id,
      requirementId: next.id,
      pages: next.pages,
      navigation: mapNavigationToBaseline(next.pages, next.navigation)
    });
    await writeDocumentAtomic(this.documentFile(next.product_id, next.id), input.document_md);
    await writeYamlAtomic(this.requirementFile(next.product_id, next.id), next);

    return next;
  }

  async archiveRequirement(requirementId: string): Promise<Requirement> {
    const current = await this.readRequirementById(requirementId);
    if (current.status !== "active") {
      throw new FormaError("REQUIREMENT_STATUS_INVALID", "Requirement status invalid", {
        requirement_id: requirementId,
        status: current.status
      });
    }

    const next = requirementSchema.parse({ ...current, status: "archived", updated_at: new Date().toISOString() });
    await writeYamlAtomic(this.requirementFile(next.product_id, next.id), next);
    return next;
  }

  async getRequirement(input: { requirement_id: string } | { product_id: string }): Promise<RequirementWithDocument> {
    if ("requirement_id" in input) {
      const requirement = await this.readRequirementById(input.requirement_id);
      return this.withDocument(requirement);
    }

    return this.withDocument(await this.getLatestRequirement(input.product_id));
  }

  async getRequirementHistory(productId: string): Promise<RequirementWithDocument[]> {
    await this.products.getProduct(productId);
    const requirements = await this.readProductRequirements(productId);
    const ordered = requirements.sort(compareCreatedAtAsc);
    return Promise.all(ordered.map((requirement) => this.withDocument(requirement)));
  }

  async getLatestRequirement(productId: string): Promise<Requirement> {
    await this.products.getProduct(productId);
    const requirements = await this.readProductRequirements(productId);
    const latest = requirements.sort(compareCreatedAtDesc)[0];
    if (!latest) {
      throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found", { product_id: productId });
    }

    return latest;
  }

  private async withDocument(requirement: Requirement): Promise<RequirementWithDocument> {
    return { ...requirement, document_md: await this.readDocument(requirement.product_id, requirement.id) };
  }

  private async readRequirementById(requirementId: string): Promise<Requirement> {
    const parsedRequirementId = this.parseRequirementId(requirementId);
    const products = await this.products.listProducts();
    for (const product of products) {
      const file = this.requirementFile(product.id, parsedRequirementId);
      if (await fileExists(file)) {
        const requirement = await readYamlAs(file, requirementSchema);
        if (requirement.id === parsedRequirementId && requirement.product_id === product.id) {
          return requirement;
        }
      }
    }

    throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found", { requirement_id: parsedRequirementId });
  }

  private async readProductRequirements(productId: string): Promise<Requirement[]> {
    const productDir = join(this.dataDir, productId);
    if (!(await fileExists(productDir))) {
      return [];
    }

    const entries = await readdir(productDir, { withFileTypes: true });
    const requirements = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && /^R-[a-f0-9]{8}$/.test(entry.name))
        .map(async (entry) => {
          const requirement = await readYamlAs(this.requirementFile(productId, entry.name), requirementSchema);
          return requirement.id === entry.name && requirement.product_id === productId ? requirement : null;
        })
    );

    return requirements.filter((requirement): requirement is Requirement => requirement !== null);
  }

  private async readDocument(productId: string, requirementId: string): Promise<string> {
    const file = this.documentFile(productId, requirementId);
    if (!(await fileExists(file))) {
      return "";
    }

    return readFile(file, "utf8");
  }

  private requirementFile(productId: string, requirementId: string): string {
    return join(this.dataDir, productId, requirementId, "requirement.yaml");
  }

  private documentFile(productId: string, requirementId: string): string {
    return join(this.dataDir, productId, requirementId, "document.md");
  }

  private parseRequirementId(requirementId: string): string {
    const parsed = requirementIdSchema.safeParse(requirementId);
    if (!parsed.success) {
      throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found", { requirement_id: requirementId });
    }

    return parsed.data;
  }
}

function assertDocument(documentMd: string): void {
  if (documentMd.trim().length === 0) {
    throw new FormaError("DOCUMENT_EMPTY", "Document is empty");
  }
}

function assertPages(pages: unknown[]): void {
  if (pages.length === 0) {
    throw new FormaError("PAGES_EMPTY", "Pages are empty");
  }
}

function mapNavigationToBaseline(
  pages: RequirementPage[],
  navigation: z.infer<typeof baselineNavigationSchema>[]
): z.infer<typeof baselineNavigationSchema>[] {
  const activePages = pages.filter((page) => page.design_status !== "expired");
  const pageToBaseline = new Map(
    activePages.flatMap((page) => [
      [page.page_id, page.baseline_page],
      [page.baseline_page, page.baseline_page]
    ])
  );

  return navigation.flatMap((item) => {
    const from = pageToBaseline.get(item.from);
    const to = pageToBaseline.get(item.to);
    return from && to ? [{ ...item, from, to }] : [];
  });
}

function compareCreatedAtAsc(a: Requirement, b: Requirement): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function compareCreatedAtDesc(a: Requirement, b: Requirement): number {
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}

async function writeDocumentAtomic(file: string, content: string): Promise<void> {
  const parentDir = dirname(file);
  await mkdir(parentDir, { recursive: true });

  const tempFile = join(parentDir, `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(tempFile, content, "utf8");
    await rename(tempFile, file);
  } catch (error) {
    await rm(tempFile, { force: true });
    throw error;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
