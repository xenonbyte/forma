import type { DesignPointer } from "./product.js";

export type GetRequirementPageIds = (productId: string, requirementId: string) => Promise<readonly string[]>;

export interface RequirementDesignPointerFilterDeps {
  listDesignPointers: (productId: string) => Promise<DesignPointer[]>;
  getRequirementPageIds?: GetRequirementPageIds;
}

export async function listCurrentRequirementDesignPointers(
  deps: RequirementDesignPointerFilterDeps,
  productId: string,
  requirementId: string,
): Promise<DesignPointer[]> {
  const allPointers = await deps.listDesignPointers(productId);
  const activePointers = allPointers.filter((p) => p.requirementId === requirementId && p.designStatus === "active");

  if (!deps.getRequirementPageIds) {
    return activePointers;
  }

  const currentPageIds = new Set(await deps.getRequirementPageIds(productId, requirementId));
  return activePointers.filter((pointer) => currentPageIds.has(pointer.pageId));
}
