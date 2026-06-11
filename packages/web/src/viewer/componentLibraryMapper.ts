import type { NormalizeArtifactInput } from "@xenonbyte/forma-viewer";
import type { Platform } from "../api.js";
import { canvasSizeForPlatform } from "./mapArtifacts.js";

export interface ComponentLibraryUnit {
  id: string;
  title: string;
  role: "foundations" | "icon" | "component";
  entry: string;
  width?: number;
  height?: number;
}

export interface MapComponentLibraryInput {
  artifactId: string;
  version: number;
  platform: Platform | undefined;
  units: ComponentLibraryUnit[];
}

/**
 * 一个 component-library artifact 的 forma.units → 每个 unit 一个 NormalizeArtifactInput,
 * 全部归入固定的 "brand-resources" 分组以便横向排布。variant = 零填充序号 + unit id:
 * 既是稳定唯一的 tile-id/选中键,其字典序(buildGroups 的 compareVariant 使用)又能
 * 保持 emit 顺序 —— Foundations → Icon → 各组件。
 */
export function mapComponentLibraryUnits(input: MapComponentLibraryInput): NormalizeArtifactInput[] {
  const fallback = canvasSizeForPlatform(input.platform);
  return input.units.map((u, i) => ({
    artifactId: input.artifactId,
    kind: "component-library" as const,
    pageId: "brand-resources",
    pageName: "brand-resources",
    variant: `${String(i).padStart(3, "0")}-${u.id}`,
    title: u.title,
    version: input.version,
    width: u.width ?? fallback.width,
    height: u.height ?? fallback.height,
    ...(input.platform !== undefined ? { platform: input.platform } : {}),
    bundlePath: u.entry,
  }));
}
