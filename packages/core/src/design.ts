import { access, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { flattenPen, getPenAnnotations, type AnnotationNode } from "./annotate.js";
import { diffAnnotations, type DesignDiff } from "./diff.js";
import { FormaError } from "./errors.js";
import { createId } from "./ids.js";
import { PencilService } from "./pencil.js";
import type { ProductService } from "./product.js";
import { requirementSchema, type Requirement, type RequirementPage } from "./requirement.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const designIdSchema = z.string().regex(/^D-[a-f0-9]{8}$/);
const exportFormats = ["png", "svg", "pdf"] as const;
const exportFormatSchema = z.enum(exportFormats);
const exportNodeIdSchema = z.string().min(1).regex(/^(?!\.{1,2}$)(?!.*[\\/])[\w.-]+$/);

const designHistoryEntrySchema = z.object({
  version: z.number().int().positive(),
  file: z.string().regex(/^design\.v[1-9]\d*\.pen$/),
  created_at: z.string().datetime()
}).strict();

export const designSchema = z.object({
  id: designIdSchema,
  product_id: z.string().regex(/^P-[a-f0-9]{6}$/),
  requirement_id: z.string().regex(/^R-[a-f0-9]{8}$/),
  page_id: z.string().min(1),
  version: z.number().int().positive(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  history: z.array(designHistoryEntrySchema)
}).strict();

export type Design = z.infer<typeof designSchema>;
export type SaveDesignMode = "generate" | "update" | "refine";

export interface SaveDesignInput {
  page_id: string;
  penPath: string;
  previewPath: string;
  mode?: SaveDesignMode;
}

export interface ExportedDesignAsset {
  design_id: string;
  node_id: string;
  format: (typeof exportFormats)[number];
  path: string;
  source: string;
}

export interface DesignValidator {
  validatePenFile(filePath: string): Promise<void>;
}

export interface DesignExporter {
  exportPreview?(penPath: string, previewPath: string): Promise<void>;
}

export interface DesignServiceOptions {
  home: string;
  products: ProductService;
  validator?: DesignValidator;
  exporter?: DesignExporter;
}

export class DesignService {
  private readonly dataDir: string;
  private readonly products: ProductService;
  private readonly validator: DesignValidator;
  private readonly exporter?: DesignExporter;

  constructor(options: DesignServiceOptions) {
    this.dataDir = join(options.home, "data");
    this.products = options.products;
    this.validator = options.validator ?? new PencilService({ home: options.home });
    this.exporter = options.exporter;
  }

  async saveDesigns(requirementId: string, inputs: SaveDesignInput[]): Promise<Design[]> {
    const requirement = await this.readRequirementById(requirementId);
    const pagesById = new Map(requirement.pages.map((page) => [page.page_id, page]));
    const saved: Design[] = [];

    for (const input of inputs) {
      const page = pagesById.get(input.page_id);
      if (!page) {
        throw new FormaError("PAGE_NOT_OWNED", "Page is not owned by requirement", {
          requirement_id: requirement.id,
          page_id: input.page_id
        });
      }
      await this.validator.validatePenFile(input.penPath);

      if (input.mode === "refine" && page.design_status !== "done") {
        throw new FormaError("PAGE_NOT_DONE", "Page is not done", { requirement_id: requirement.id, page_id: page.page_id });
      }

      const next = page.design_id
        ? await this.replaceExistingDesign(requirement, page, input)
        : await this.createDesign(requirement, page, input);
      saved.push(next);
      pagesById.set(page.page_id, { ...page, design_status: "done", design_id: next.id });
    }

    await this.writeRequirement({
      ...requirement,
      status: [...pagesById.values()].every((page) => page.design_status === "done") ? "active" : requirement.status,
      updated_at: new Date().toISOString(),
      pages: requirement.pages.map((page) => pagesById.get(page.page_id) ?? page)
    });
    return saved;
  }

  async rollbackDesign(designId: string): Promise<Design> {
    const current = await this.readDesignById(designId);
    if (current.version <= 1) {
      throw new FormaError("VERSION_TOO_LOW", "Design version is too low", { design_id: current.id, version: current.version });
    }

    const previousVersion = current.version - 1;
    const designDir = this.designDir(current);
    const previousPen = join(designDir, `design.v${previousVersion}.pen`);
    if (!(await fileExists(previousPen))) {
      throw new FormaError("HISTORY_FILE_MISSING", "Design history file is missing", {
        design_id: current.id,
        version: previousVersion,
        file: `design.v${previousVersion}.pen`
      });
    }

    await copyFileAtomic(previousPen, join(designDir, "design.pen"));
    if (this.exporter?.exportPreview) {
      await this.exporter.exportPreview(join(designDir, "design.pen"), join(designDir, "preview@2x.png"));
    }

    const next = designSchema.parse({
      ...current,
      version: previousVersion,
      updated_at: new Date().toISOString(),
      history: current.history.filter((entry) => entry.version < previousVersion)
    });
    await writeYamlAtomic(this.designFile(next), next);
    return next;
  }

  async getDesignAnnotations(designId: string): Promise<AnnotationNode[]> {
    const design = await this.readDesignById(designId);
    return getPenAnnotations(join(this.designDir(design), "design.pen"));
  }

  async diffDesigns(designId: string, v1: number, v2: number): Promise<DesignDiff> {
    const design = await this.readDesignById(designId);
    const before = await this.annotationsForVersion(design, v1);
    const after = await this.annotationsForVersion(design, v2);
    return diffAnnotations(before, after);
  }

  async exportDesignAsset(designId: string, nodeId: string, format: ExportedDesignAsset["format"]): Promise<ExportedDesignAsset> {
    const design = await this.readDesignById(designId);
    const safeNodeId = this.parseExportNodeId(nodeId, design.id);
    const safeFormat = this.parseExportFormat(format);
    const node = (await this.getDesignAnnotations(design.id)).find((item) => item.id === safeNodeId);
    if (!node) {
      throw new FormaError("NODE_NOT_FOUND", "Node not found", { design_id: design.id, node_id: safeNodeId });
    }

    const exportsDir = join(this.designDir(design), "exports");
    const output = join(exportsDir, `${safeNodeId}.${safeFormat}`);
    await mkdir(exportsDir, { recursive: true });
    if (safeFormat === "png") {
      await copyFileAtomic(join(this.designDir(design), "preview@2x.png"), output);
    } else {
      await writePlaceholderAtomic(output, `${safeFormat} export placeholder for ${design.id}/${safeNodeId}\n`);
    }

    return { design_id: design.id, node_id: safeNodeId, format: safeFormat, path: output, source: "preview" };
  }

  private async createDesign(requirement: Requirement, page: RequirementPage, input: SaveDesignInput): Promise<Design> {
    const now = new Date().toISOString();
    const design = designSchema.parse({
      id: createId("design"),
      product_id: requirement.product_id,
      requirement_id: requirement.id,
      page_id: page.page_id,
      version: 1,
      created_at: now,
      updated_at: now,
      history: []
    });
    await this.copyOutput(input, design);
    await writeYamlAtomic(this.designFile(design), design);
    return design;
  }

  private async replaceExistingDesign(requirement: Requirement, page: RequirementPage, input: SaveDesignInput): Promise<Design> {
    if (page.design_status !== "done") {
      throw new FormaError("PAGE_NOT_DONE", "Page is not done", { requirement_id: requirement.id, page_id: page.page_id });
    }
    const current = await this.readDesignById(page.design_id);
    if (current.product_id !== requirement.product_id || current.requirement_id !== requirement.id || current.page_id !== page.page_id) {
      throw new FormaError("PAGE_NOT_OWNED", "Page design is not owned by requirement", {
        requirement_id: requirement.id,
        page_id: page.page_id,
        design_id: current.id
      });
    }
    const designDir = this.designDir(current);
    const historyFile = `design.v${current.version}.pen`;
    await copyFileAtomic(join(designDir, "design.pen"), join(designDir, historyFile));
    await this.copyOutput(input, current);

    const now = new Date().toISOString();
    const next = designSchema.parse({
      ...current,
      version: current.version + 1,
      updated_at: now,
      history: [...current.history, { version: current.version, file: historyFile, created_at: now }]
    });
    await writeYamlAtomic(this.designFile(next), next);
    return next;
  }

  private async copyOutput(input: SaveDesignInput, design: Design): Promise<void> {
    const designDir = this.designDir(design);
    await mkdir(designDir, { recursive: true });
    await copyFileAtomic(input.penPath, join(designDir, "design.pen"));
    await copyFileAtomic(input.previewPath, join(designDir, "preview@2x.png"));
  }

  private async annotationsForVersion(design: Design, version: number): Promise<AnnotationNode[]> {
    if (!Number.isInteger(version) || version < 1 || version > design.version) {
      throw new FormaError("HISTORY_FILE_MISSING", "Design history file is missing", { design_id: design.id, version });
    }

    const penFile = version === design.version ? "design.pen" : `design.v${version}.pen`;
    const penPath = join(this.designDir(design), penFile);
    if (!(await fileExists(penPath))) {
      throw new FormaError("HISTORY_FILE_MISSING", "Design history file is missing", {
        design_id: design.id,
        version,
        file: penFile
      });
    }
    return flattenPen(JSON.parse(await readFile(penPath, "utf8")));
  }

  private async readDesignById(designId: string | undefined): Promise<Design> {
    const parsedDesignId = this.parseDesignId(designId);
    const products = await this.products.listProducts();
    for (const product of products) {
      const productDir = join(this.dataDir, product.id);
      if (!(await fileExists(productDir))) {
        continue;
      }
      const requirementEntries = await readdir(productDir, { withFileTypes: true });
      for (const requirementEntry of requirementEntries.filter((entry) => entry.isDirectory() && /^R-[a-f0-9]{8}$/.test(entry.name))) {
        const designFile = join(productDir, requirementEntry.name, parsedDesignId, "design.yaml");
        if (await fileExists(designFile)) {
          const design = await readYamlAs(designFile, designSchema);
          if (design.id === parsedDesignId && design.product_id === product.id && design.requirement_id === requirementEntry.name) {
            return design;
          }
        }
      }
    }

    throw new FormaError("DESIGN_NOT_FOUND", "Design not found", { design_id: parsedDesignId });
  }

  private async readRequirementById(requirementId: string): Promise<Requirement> {
    const parsedRequirementId = this.parseRequirementId(requirementId);
    const products = await this.products.listProducts();
    for (const product of products) {
      const file = join(this.dataDir, product.id, parsedRequirementId, "requirement.yaml");
      if (await fileExists(file)) {
        const requirement = await readYamlAs(file, requirementSchema);
        if (requirement.id === parsedRequirementId && requirement.product_id === product.id) {
          return requirement;
        }
      }
    }

    throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found", { requirement_id: parsedRequirementId });
  }

  private async writeRequirement(requirement: Requirement): Promise<void> {
    await writeYamlAtomic(join(this.dataDir, requirement.product_id, requirement.id, "requirement.yaml"), requirementSchema.parse(requirement));
  }

  private designDir(design: Design): string {
    return join(this.dataDir, design.product_id, design.requirement_id, design.id);
  }

  private designFile(design: Design): string {
    return join(this.designDir(design), "design.yaml");
  }

  private parseRequirementId(requirementId: string): string {
    const parsed = z.string().regex(/^R-[a-f0-9]{8}$/).safeParse(requirementId);
    if (!parsed.success) {
      throw new FormaError("REQUIREMENT_NOT_FOUND", "Requirement not found", { requirement_id: requirementId });
    }
    return parsed.data;
  }

  private parseDesignId(designId: string | undefined): string {
    const parsed = designIdSchema.safeParse(designId);
    if (!parsed.success) {
      throw new FormaError("DESIGN_NOT_FOUND", "Design not found", { design_id: designId });
    }
    return parsed.data;
  }

  private parseExportNodeId(nodeId: string, designId: string): string {
    const parsed = exportNodeIdSchema.safeParse(nodeId);
    if (!parsed.success) {
      throw new FormaError("NODE_NOT_FOUND", "Node not found", { design_id: designId, node_id: nodeId });
    }
    return parsed.data;
  }

  private parseExportFormat(format: unknown): ExportedDesignAsset["format"] {
    const parsed = exportFormatSchema.safeParse(format);
    if (!parsed.success) {
      throw new FormaError("EXPORT_FORMAT_UNSUPPORTED", "Export format is unsupported", { format });
    }
    return parsed.data;
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

async function writePlaceholderAtomic(destination: string, content: string): Promise<void> {
  const parentDir = dirname(destination);
  await mkdir(parentDir, { recursive: true });
  const tempFile = join(parentDir, `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(tempFile, content, "utf8");
    await rename(tempFile, destination);
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
