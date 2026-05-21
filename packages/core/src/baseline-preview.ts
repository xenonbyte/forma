import { access } from "node:fs/promises";
import { getRequirementDesign } from "./requirement-design.js";

export interface BaselinePreviewStore {
  home: string;
  baseline: {
    getProductBaseline(productId: string): Promise<{ pages: Array<{ id: string; source_requirements: string[] }> }>;
  };
  requirements: {
    getRequirementHistory(productId: string): Promise<Array<{
      id: string;
      status?: string;
      created_at?: string;
      updated_at?: string;
      pages: Array<{ page_id: string; baseline_page?: string; design_status?: string }>;
    }>>;
  };
}

export interface BaselinePreviewMetadata {
  product_id: string;
  baseline_page_id: string;
  requirement_id: string;
  requirement_page_id: string;
  preview_url: string;
  preview_path: string;
  canvas_path: string;
  page_version?: number;
  canvas_version: number;
}

export async function findBaselinePreviewMetadata(
  store: BaselinePreviewStore,
  productId: string,
  pageId: string
): Promise<BaselinePreviewMetadata | undefined> {
  const baseline = await store.baseline.getProductBaseline(productId);
  const page = baseline.pages.find((item) => item.id === pageId);
  if (!page) {
    return undefined;
  }

  const sourceRequirements = new Set(page.source_requirements);
  const requirements = (await store.requirements.getRequirementHistory(productId))
    .filter((requirement) => sourceRequirements.has(requirement.id))
    .filter((requirement) => requirement.status !== "archived")
    .sort(compareRequirementsNewestFirst);

  for (const requirement of requirements) {
    const requirementPage = requirement.pages.find((item) => item.baseline_page === pageId);
    if (!requirementPage || requirementPage.design_status !== "done") {
      continue;
    }
    const design = await getRequirementDesign(store.home, productId, requirement.id);
    if (design.status !== "complete") {
      continue;
    }
    const designPage = design.pages.find((item) => item.page_id === requirementPage.page_id);
    if (designPage?.status !== "done" || !designPage.preview_path) {
      continue;
    }
    if (!(await fileExists(designPage.preview_path))) {
      continue;
    }

    return {
      product_id: productId,
      baseline_page_id: pageId,
      requirement_id: requirement.id,
      requirement_page_id: requirementPage.page_id,
      preview_url: `/api/products/${encodeURIComponent(productId)}/baseline/pages/${encodeURIComponent(pageId)}/image`,
      preview_path: designPage.preview_path,
      canvas_path: design.canvas_path,
      page_version: designPage.page_version,
      canvas_version: design.canvas_version
    };
  }

  return undefined;
}

function compareRequirementsNewestFirst(
  left: { id: string; created_at?: string; updated_at?: string },
  right: { id: string; created_at?: string; updated_at?: string }
): number {
  return timestampForRequirement(right) - timestampForRequirement(left) || right.id.localeCompare(left.id);
}

function timestampForRequirement(requirement: { created_at?: string; updated_at?: string }): number {
  const updatedAt = requirement.updated_at ? Date.parse(requirement.updated_at) : Number.NaN;
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  const createdAt = requirement.created_at ? Date.parse(requirement.created_at) : Number.NaN;
  return Number.isFinite(createdAt) ? createdAt : 0;
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
