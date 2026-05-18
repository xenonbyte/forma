import { access, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { flattenStoredPen, getPenAnnotations, type AnnotationNode } from "./annotate.js";
import { diffAnnotations, type DesignDiff } from "./diff.js";
import { FormaError } from "./errors.js";
import { createId } from "./ids.js";
import { PencilService } from "./pencil.js";
import type { ProductService } from "./product.js";
import { requirementSchema, type Requirement, type RequirementPage } from "./requirement.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

export const designIdSchema = z.string().regex(/^D-[a-f0-9]{8}$/);
const saveDesignModes = ["generate", "update", "refine"] as const;
const saveDesignModeSchema = z.enum(saveDesignModes);
const exportFormats = ["png", "svg", "pdf"] as const;
const exportFormatSchema = z.enum(exportFormats);
const exportNodeIdSchema = z.string().min(1).regex(/^(?!\.{1,2}$)(?!.*[\\/])[\w.-]+$/);

const designHistoryEntrySchema = z.object({
  version: z.number().int().positive(),
  file: z.string().regex(/^design\.v[1-9]\d*\.pen$/),
  preview_file: z.string().regex(/^preview\.v[1-9]\d*@2x\.png$/).optional(),
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
export type SaveDesignMode = (typeof saveDesignModes)[number];

export interface SaveDesignInput {
  page_id: string;
  penPath: string;
  previewPath: string;
  mode?: SaveDesignMode;
}

export interface DesignMetadata {
  id: string;
  pen_path: string;
  preview_path: string;
  version: number;
  created_at: string;
  updated_at: string;
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
  exportAsset?(penPath: string, outputPath: string, format: "png" | "pdf"): Promise<void>;
}

export interface DesignServiceOptions {
  home: string;
  products: ProductService;
  validator?: DesignValidator;
  exporter?: DesignExporter;
}

interface DesignServiceTestHooks {
  afterCommitExistingHistoryFiles?(): Promise<void> | void;
  afterRollbackPenWrite?(): Promise<void> | void;
  beforePostCommitStageCleanup?(): Promise<void> | void;
}

interface StagedDesignSave {
  design: Design;
  page: RequirementPage;
  stageDir: string;
  isNew: boolean;
}

interface CommittedDesignSave {
  plan: StagedDesignSave;
  backupDir?: string;
}

export class DesignService {
  private readonly home: string;
  private readonly dataDir: string;
  private readonly products: ProductService;
  private readonly validator: DesignValidator;
  private readonly exporter?: DesignExporter;
  private testHooks: DesignServiceTestHooks;

  constructor(options: DesignServiceOptions) {
    this.home = options.home;
    this.dataDir = join(options.home, "data");
    this.products = options.products;
    this.validator = options.validator ?? new PencilService({ home: options.home });
    this.exporter = options.exporter;
    this.testHooks = {};
  }

  async saveDesigns(requirementId: string, inputs: SaveDesignInput[]): Promise<Design[]> {
    const requirement = await this.readRequirementById(requirementId);
    const pagesById = new Map(requirement.pages.map((page) => [page.page_id, page]));
    const stageRoot = join(this.requirementDir(requirement), `.design-stage-${randomBytes(8).toString("hex")}`);
    let staged: StagedDesignSave[] = [];
    const committed: CommittedDesignSave[] = [];

    try {
      staged = await this.stageDesignSaves(requirement, inputs, stageRoot);
      for (const plan of staged) {
        const targetDir = this.designDir(plan.design);
        if (plan.isNew) {
          await rename(plan.stageDir, targetDir);
          committed.push({ plan });
        } else {
          const backupDir = join(stageRoot, `backup-${plan.design.id}-${randomBytes(4).toString("hex")}`);
          await this.backupCurrentDesign(targetDir, backupDir);
          committed.push({ plan, backupDir });
          await this.commitExistingDesignStage(plan.stageDir, targetDir, plan.design);
        }
        pagesById.set(plan.page.page_id, { ...plan.page, design_status: "done", design_id: plan.design.id });
      }

      await this.writeRequirement({
        ...requirement,
        status: [...pagesById.values()].every((page) => page.design_status === "done") ? "active" : requirement.status,
        updated_at: new Date().toISOString(),
        pages: requirement.pages.map((page) => pagesById.get(page.page_id) ?? page)
      });

      await this.cleanupStageAfterCommit(stageRoot);
      return staged.map((plan) => plan.design);
    } catch (error) {
      await this.rollbackCommittedSaves(committed);
      await rm(stageRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async rollbackDesign(designId: string): Promise<Design> {
    const current = await this.readDesignById(designId);
    if (current.version <= 1) {
      throw new FormaError("VERSION_TOO_LOW", "Design version is too low", { design_id: current.id, version: current.version });
    }
    await this.assertRollbackOwnership(current);

    const previousVersion = current.version - 1;
    const designDir = this.designDir(current);
    const stageRoot = join(designDir, `.rollback-stage-${randomBytes(8).toString("hex")}`);
    const backupDir = join(stageRoot, "backup");
    const nextDir = join(stageRoot, "next");
    const historyEntry = current.history.find((entry) => entry.version === previousVersion);
    const previousPen = join(designDir, `design.v${previousVersion}.pen`);
    const expectedPreviewFile = `preview.v${previousVersion}@2x.png`;
    if (!historyEntry || historyEntry.file !== `design.v${previousVersion}.pen` || historyEntry.preview_file !== expectedPreviewFile) {
      throw new FormaError("HISTORY_FILE_MISSING", "Design history file is missing", {
        design_id: current.id,
        version: previousVersion,
        file: `design.v${previousVersion}.pen`
      });
    }
    const previousPreviewFile = historyEntry.preview_file;
    const previousPreview = join(designDir, previousPreviewFile);
    if (!(await fileExists(previousPen))) {
      throw new FormaError("HISTORY_FILE_MISSING", "Design history file is missing", {
        design_id: current.id,
        version: previousVersion,
        file: `design.v${previousVersion}.pen`
      });
    }
    if (!(await fileExists(previousPreview))) {
      throw new FormaError("HISTORY_FILE_MISSING", "Design history file is missing", {
        design_id: current.id,
        version: previousVersion,
        file: previousPreviewFile
      });
    }

    const next = designSchema.parse({
      ...current,
      version: previousVersion,
      updated_at: new Date().toISOString(),
      history: current.history.filter((entry) => entry.version < previousVersion)
    });

    await mkdir(nextDir, { recursive: true });
    await copyFileAtomic(previousPen, join(nextDir, "design.pen"));
    await copyFileAtomic(previousPreview, join(nextDir, "preview@2x.png"));
    await writeYamlAtomic(join(nextDir, "design.yaml"), next);
    await this.backupCurrentDesign(designDir, backupDir);

    try {
      await copyFileAtomic(join(nextDir, "design.pen"), join(designDir, "design.pen"));
      await this.testHooks.afterRollbackPenWrite?.();
      await copyFileAtomic(join(nextDir, "preview@2x.png"), join(designDir, "preview@2x.png"));
      await copyFileAtomic(join(nextDir, "design.yaml"), join(designDir, "design.yaml"));
      await rm(stageRoot, { recursive: true, force: true });
    } catch (error) {
      await this.restoreDesignBackup(designDir, backupDir);
      await rm(stageRoot, { recursive: true, force: true });
      throw error;
    }
    return next;
  }

  async getDesignAnnotations(designId: string): Promise<AnnotationNode[]> {
    const design = await this.readDesignById(designId);
    return getPenAnnotations(join(this.designDir(design), "design.pen"));
  }

  async getDesignMetadata(designId: string): Promise<DesignMetadata> {
    const design = await this.readDesignById(designId);
    const designDir = this.designDir(design);
    return {
      id: design.id,
      pen_path: join(designDir, "design.pen"),
      preview_path: join(designDir, "preview@2x.png"),
      version: design.version,
      created_at: design.created_at,
      updated_at: design.updated_at
    };
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
    const annotations = await this.getDesignAnnotations(design.id);
    const node = annotations.find((item) => item.id === safeNodeId);
    if (!node) {
      throw new FormaError("NODE_NOT_FOUND", "Node not found", { design_id: design.id, node_id: safeNodeId });
    }

    const exportsDir = join(this.designDir(design), "exports");
    const output = join(exportsDir, `${safeNodeId}.${safeFormat}`);
    await mkdir(exportsDir, { recursive: true });
    if (safeFormat === "svg") {
      await writeTextAtomic(output, svgForNode(node, annotations));
    } else {
      await this.exportRasterNode(design, safeNodeId, output, safeFormat);
    }

    return { design_id: design.id, node_id: safeNodeId, format: safeFormat, path: output, source: "node" };
  }

  private async stageDesignSaves(requirement: Requirement, inputs: SaveDesignInput[], stageRoot: string): Promise<StagedDesignSave[]> {
    const pagesById = new Map(requirement.pages.map((page) => [page.page_id, page]));
    const staged: StagedDesignSave[] = [];
    await mkdir(stageRoot, { recursive: true });

    for (const input of inputs) {
      const page = pagesById.get(input.page_id);
      if (!page) {
        throw new FormaError("PAGE_NOT_OWNED", "Page is not owned by requirement", {
          requirement_id: requirement.id,
          page_id: input.page_id
        });
      }
      await this.validator.validatePenFile(input.penPath);
      const mode = this.parseSaveDesignMode(input.mode);
      this.assertSaveModeAllowed(mode, requirement, page);

      const stageDir = join(stageRoot, `${staged.length}-${randomBytes(4).toString("hex")}`);
      const stagedSave = mode === "update" || mode === "refine"
        ? await this.stageExistingDesign(requirement, page, input, stageDir)
        : await this.stageNewDesign(requirement, page, input, stageDir);
      staged.push(stagedSave);
      pagesById.set(page.page_id, { ...page, design_status: "done", design_id: stagedSave.design.id });
    }

    return staged;
  }

  private async stageNewDesign(
    requirement: Requirement,
    page: RequirementPage,
    input: SaveDesignInput,
    stageDir: string
  ): Promise<StagedDesignSave> {
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
    await this.stageOutput(input, stageDir);
    await writeYamlAtomic(join(stageDir, "design.yaml"), design);
    return { design, page, stageDir, isNew: true };
  }

  private async stageExistingDesign(
    requirement: Requirement,
    page: RequirementPage,
    input: SaveDesignInput,
    stageDir: string
  ): Promise<StagedDesignSave> {
    if (page.design_status !== "done" && page.design_status !== "expired") {
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
    const historyPreviewFile = `preview.v${current.version}@2x.png`;
    if (!(await fileExists(join(designDir, "design.pen")))) {
      throw new FormaError("HISTORY_FILE_MISSING", "Design history file is missing", {
        design_id: current.id,
        version: current.version,
        file: "design.pen"
      });
    }
    if (!(await fileExists(join(designDir, "preview@2x.png")))) {
      throw new FormaError("HISTORY_FILE_MISSING", "Design history file is missing", {
        design_id: current.id,
        version: current.version,
        file: "preview@2x.png"
      });
    }

    await mkdir(stageDir, { recursive: true });
    await copyFileAtomic(join(designDir, "design.pen"), join(stageDir, historyFile));
    await copyFileAtomic(join(designDir, "preview@2x.png"), join(stageDir, historyPreviewFile));
    await this.stageOutput(input, stageDir);

    const now = new Date().toISOString();
    const next = designSchema.parse({
      ...current,
      version: current.version + 1,
      updated_at: now,
      history: [
        ...current.history,
        { version: current.version, file: historyFile, preview_file: historyPreviewFile, created_at: now }
      ]
    });
    await writeYamlAtomic(join(stageDir, "design.yaml"), next);
    return { design: next, page, stageDir, isNew: false };
  }

  private async stageOutput(input: SaveDesignInput, stageDir: string): Promise<void> {
    await mkdir(stageDir, { recursive: true });
    await copyFileAtomic(input.penPath, join(stageDir, "design.pen"));
    await validatePngFile(input.previewPath);
    await copyFileAtomic(input.previewPath, join(stageDir, "preview@2x.png"));
  }

  private async exportRasterNode(design: Design, nodeId: string, output: string, format: "png" | "pdf"): Promise<void> {
    const sourcePenPath = join(this.designDir(design), "design.pen");
    const pen = await this.readPenDocument(sourcePenPath);
    const selectedNode = findPenNode(pen, nodeId);
    if (!selectedNode) {
      throw new FormaError("NODE_NOT_FOUND", "Node not found", { design_id: design.id, node_id: nodeId });
    }

    const tempDir = join(this.designDir(design), "exports", `.export-${randomBytes(8).toString("hex")}`);
    const tempPen = join(tempDir, "node.pen");
    await mkdir(tempDir, { recursive: true });
    try {
      await writeFile(tempPen, JSON.stringify({ ...copyPenContext(pen), children: [selectedNode] }, null, 2), "utf8");
      if (this.exporter?.exportAsset) {
        await this.exporter.exportAsset(tempPen, output, format);
      } else if (format === "png" && this.exporter?.exportPreview) {
        await this.exporter.exportPreview(tempPen, output);
      } else {
        await new PencilService({ home: this.home }).exportAsset(tempPen, output, format);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async commitExistingDesignStage(stageDir: string, targetDir: string, design: Design): Promise<void> {
    await mkdir(targetDir, { recursive: true });
    for (const entry of design.history) {
      if (await fileExists(join(stageDir, entry.file))) {
        await copyFileAtomic(join(stageDir, entry.file), join(targetDir, entry.file));
      }
      if (entry.preview_file && (await fileExists(join(stageDir, entry.preview_file)))) {
        await copyFileAtomic(join(stageDir, entry.preview_file), join(targetDir, entry.preview_file));
      }
    }
    await this.testHooks.afterCommitExistingHistoryFiles?.();
    await copyFileAtomic(join(stageDir, "design.pen"), join(targetDir, "design.pen"));
    await copyFileAtomic(join(stageDir, "preview@2x.png"), join(targetDir, "preview@2x.png"));
    await copyFileAtomic(join(stageDir, "design.yaml"), join(targetDir, "design.yaml"));
  }

  private async backupCurrentDesign(targetDir: string, backupDir: string): Promise<void> {
    await mkdir(backupDir, { recursive: true });
    await copyFileAtomic(join(targetDir, "design.pen"), join(backupDir, "design.pen"));
    await copyFileAtomic(join(targetDir, "preview@2x.png"), join(backupDir, "preview@2x.png"));
    await copyFileAtomic(join(targetDir, "design.yaml"), join(backupDir, "design.yaml"));
  }

  private async rollbackCommittedSaves(committed: CommittedDesignSave[]): Promise<void> {
    for (const item of [...committed].reverse()) {
      const targetDir = this.designDir(item.plan.design);
      if (item.plan.isNew) {
        await rm(targetDir, { recursive: true, force: true });
        continue;
      }

      const restoredVersion = item.plan.design.version - 1;
      await rm(join(targetDir, `design.v${restoredVersion}.pen`), { force: true });
      await rm(join(targetDir, `preview.v${restoredVersion}@2x.png`), { force: true });
      if (item.backupDir) {
        await this.restoreDesignBackup(targetDir, item.backupDir);
      }
    }
  }

  private async cleanupStageAfterCommit(stageRoot: string): Promise<void> {
    try {
      await this.testHooks.beforePostCommitStageCleanup?.();
      await rm(stageRoot, { recursive: true, force: true });
    } catch {
      // Staging cleanup happens after the save transaction is committed. It must not roll back persisted design state.
    }
  }

  private async restoreDesignBackup(targetDir: string, backupDir: string): Promise<void> {
    await copyFileAtomic(join(backupDir, "design.pen"), join(targetDir, "design.pen"));
    await copyFileAtomic(join(backupDir, "preview@2x.png"), join(targetDir, "preview@2x.png"));
    await copyFileAtomic(join(backupDir, "design.yaml"), join(targetDir, "design.yaml"));
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
    return this.readPenAnnotations(penPath);
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

  private async assertRollbackOwnership(design: Design): Promise<void> {
    const requirements = await this.readProductRequirements(design.product_id);
    const latest = requirements.sort(compareRequirementCreatedAtDesc)[0];
    const page = latest?.pages.find((item) => item.page_id === design.page_id);
    if (
      !latest ||
      latest.id !== design.requirement_id ||
      !page ||
      page.design_status !== "done" ||
      page.design_id !== design.id
    ) {
      throw new FormaError("PAGE_NOT_OWNED", "Page is not owned by current requirement", {
        design_id: design.id,
        requirement_id: design.requirement_id,
        page_id: design.page_id,
        current_requirement_id: latest?.id
      });
    }
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
          const requirement = await readYamlAs(join(productDir, entry.name, "requirement.yaml"), requirementSchema);
          return requirement.id === entry.name && requirement.product_id === productId ? requirement : null;
        })
    );

    return requirements.filter((requirement): requirement is Requirement => requirement !== null);
  }

  private async writeRequirement(requirement: Requirement): Promise<void> {
    await writeYamlAtomic(join(this.requirementDir(requirement), "requirement.yaml"), requirementSchema.parse(requirement));
  }

  private async readPenAnnotations(penPath: string): Promise<AnnotationNode[]> {
    try {
      return flattenStoredPen(JSON.parse(await readFile(penPath, "utf8")));
    } catch (error) {
      if (error instanceof FormaError) {
        throw new FormaError("PEN_FILE_INVALID", "Pen file is invalid", { file: penPath, cause: error.message });
      }
      throw new FormaError("PEN_FILE_INVALID", "Pen file is invalid", {
        file: penPath,
        cause: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async readPenDocument(penPath: string): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await readFile(penPath, "utf8"));
      flattenStoredPen(parsed);
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch (error) {
      if (error instanceof FormaError) {
        throw new FormaError("PEN_FILE_INVALID", "Pen file is invalid", { file: penPath, cause: error.message });
      }
      throw new FormaError("PEN_FILE_INVALID", "Pen file is invalid", {
        file: penPath,
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    throw new FormaError("PEN_FILE_INVALID", "Pen file is invalid", { file: penPath });
  }

  private requirementDir(requirement: Requirement): string {
    return join(this.dataDir, requirement.product_id, requirement.id);
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

  private parseSaveDesignMode(mode: unknown): SaveDesignMode {
    const parsed = saveDesignModeSchema.safeParse(mode ?? "generate");
    if (!parsed.success) {
      throw new FormaError("DESIGN_MODE_INVALID", "Design mode is invalid", { mode });
    }
    return parsed.data;
  }

  private assertSaveModeAllowed(mode: SaveDesignMode, requirement: Requirement, page: RequirementPage): void {
    const hasExistingDesign = typeof page.design_id === "string";
    if (mode === "generate") {
      if (hasExistingDesign) {
        throw new FormaError("DESIGN_MODE_INVALID", "Design mode is invalid", {
          requirement_id: requirement.id,
          page_id: page.page_id,
          mode
        });
      }
      return;
    }

    if (mode === "refine" && page.design_status === "expired" && page.design_id && page.change_type === "patch") {
      return;
    }
    if (mode === "update" && page.design_status === "expired" && page.design_id && page.change_type === "rebuild") {
      return;
    }

    if (page.design_status !== "done") {
      if (mode === "refine") {
        throw new FormaError("PAGE_NOT_DONE", "Page is not done", { requirement_id: requirement.id, page_id: page.page_id });
      }
      throw new FormaError("DESIGN_MODE_INVALID", "Design mode is invalid", {
        requirement_id: requirement.id,
        page_id: page.page_id,
        mode
      });
    }

    if (!hasExistingDesign) {
      throw new FormaError("DESIGN_MODE_INVALID", "Design mode is invalid", {
        requirement_id: requirement.id,
        page_id: page.page_id,
        mode
      });
    }
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

async function writeTextAtomic(destination: string, content: string): Promise<void> {
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

async function validatePngFile(file: string): Promise<void> {
  const bytes = await readFile(file).catch((error: unknown) => {
    throw new FormaError("PEN_FILE_INVALID", "Preview file is invalid", {
      file,
      cause: error instanceof Error ? error.message : String(error)
    });
  });
  if (!hasPngSignature(bytes)) {
    throw new FormaError("PEN_FILE_INVALID", "Preview file is invalid", { file });
  }
}

function hasPngSignature(value: Buffer): boolean {
  return (
    value.length >= 8 &&
    value[0] === 0x89 &&
    value[1] === 0x50 &&
    value[2] === 0x4e &&
    value[3] === 0x47 &&
    value[4] === 0x0d &&
    value[5] === 0x0a &&
    value[6] === 0x1a &&
    value[7] === 0x0a
  );
}

function findPenNode(pen: Record<string, unknown>, nodeId: string): Record<string, unknown> | undefined {
  const roots = Array.isArray(pen.children) ? pen.children : [];
  for (const root of roots) {
    const found = findNodeInTree(root, nodeId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findNodeInTree(node: unknown, nodeId: string): Record<string, unknown> | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  if (node.id === nodeId) {
    return node;
  }
  const children = [
    ...(Array.isArray(node.children) ? node.children : []),
    ...(Array.isArray(node.layers) ? node.layers : [])
  ];
  for (const child of children) {
    const found = findNodeInTree(child, nodeId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function copyPenContext(pen: Record<string, unknown>): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  if (isRecord(pen.variables)) {
    context.variables = pen.variables;
  }
  return context;
}

function svgForNode(root: AnnotationNode, annotations: AnnotationNode[]): string {
  const nodes = annotations.filter((node) => node.id === root.id || isDescendant(node, root.id, annotations));
  const width = Math.max(1, root.width);
  const height = Math.max(1, root.height);
  const body = nodes.map(svgElementForNode).join("\n  ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" data-node-id="${escapeXml(root.id)}" data-node-name="${escapeXml(root.name)}" x="${root.x}" y="${root.y}" width="${width}" height="${height}" viewBox="${root.x} ${root.y} ${width} ${height}">`,
    `  <title>${escapeXml(root.name)}</title>`,
    `  ${body}`,
    "</svg>\n"
  ].join("\n");
}

function isDescendant(node: AnnotationNode, rootId: string, annotations: AnnotationNode[]): boolean {
  let parentId = node.parent_id;
  while (parentId) {
    if (parentId === rootId) {
      return true;
    }
    parentId = annotations.find((candidate) => candidate.id === parentId)?.parent_id;
  }
  return false;
}

function svgElementForNode(node: AnnotationNode): string {
  const common = `data-node-id="${escapeXml(node.id)}" data-node-name="${escapeXml(node.name)}"`;
  if (node.type === "text" || node.content) {
    const fontSize = node.fontSize ?? 16;
    return `<text ${common} x="${node.x}" y="${node.y + fontSize}" font-size="${fontSize}"${node.fill ? ` fill="${escapeXml(node.fill)}"` : ""}>${escapeXml(node.content ?? node.name)}</text>`;
  }
  return `<rect ${common} x="${node.x}" y="${node.y}" width="${Math.max(1, node.width)}" height="${Math.max(1, node.height)}"${node.fill ? ` fill="${escapeXml(node.fill)}"` : " fill=\"none\""}${node.stroke ? ` stroke="${escapeXml(node.stroke)}"` : ""} />`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function compareRequirementCreatedAtDesc(a: Requirement, b: Requirement): number {
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}
