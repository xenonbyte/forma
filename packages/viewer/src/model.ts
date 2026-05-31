/**
 * Forma viewer 规范化数据契约。
 *
 * 这是 web(HTTP)/desktop(IPC) 的唯一耦合点:两端各自把自身数据源映射成
 * 这套与传输无关的 view-model,再注入资源解析器。契约变更必须同步两端 + 测试。
 */

/** artifact 的产出种类。 */
export type ArtifactKind = "design-page" | "component-library";

/** 画布模式:设计画布渲 HTML,标注画布渲 PNG。共用同一外壳。 */
export type CanvasMode = "design" | "annotation";

/** 查看器入口范围:需求入口铺全需求所有页,页面入口只铺该页的 variant。 */
export type ViewerEntry = "requirement" | "page";

/** 标注 PNG 预览密度。P7 contract 显式保留 1x/2x LOD。 */
export type PreviewDensity = "1x" | "2x";

/**
 * 不透明资源引用。viewer 不知道也不关心真实 URL;由消费方注入的
 * ResourceResolver 解析(web→HTTP URL,desktop→IPC/app URL)。
 */
export interface ResourceRef {
  artifactId: string;
  version: number;
  /** bundle=自包含 HTML 入口;preview=PNG 预览;asset=bundle 内子资源(需 path)。 */
  kind: "bundle" | "preview" | "asset";
  /** kind="preview" 时的 PNG density;AnnotationTile 使用 1x/2x 生成 src/srcSet。 */
  density?: PreviewDensity;
  /** kind="asset" 时的 bundle 内相对路径。 */
  path?: string;
}

/** 标注画布 PNG 资源。1x/2x 都必须存在,对应 Phase 7 LOD contract。 */
export interface PreviewImageRefs {
  "1x": ResourceRef;
  "2x": ResourceRef;
}

/** 一个画布瓦片 = 一个 artifact 版本,可被两种渲染器渲染。 */
export interface ViewerTile {
  /** 稳定唯一 id,形如 `${artifactId}:${version}:${variant}`。 */
  id: string;
  kind: ArtifactKind;
  /** 分组键:左列表按 page 分组。 */
  pageId: string;
  pageName: string;
  /** 同页的设计变体,如 "default"。 */
  variant: string;
  title: string;
  version: number;
  /** 内在画布尺寸(布局用,单位 px)。 */
  width: number;
  height: number;
  /** 设计画布用:自包含 HTML bundle 引用。 */
  htmlBundle: ResourceRef;
  /** 标注画布用:PNG 预览引用,保留 1x/2x LOD。 */
  previewImages: PreviewImageRefs;
}

/** 左列表分组(一页一组,组内按 variant 排序)。 */
export interface ViewerGroup {
  pageId: string;
  pageName: string;
  /** 组内 tile id,按 variant 顺序。 */
  tileIds: string[];
}

/** 已定位的 tile(带画布坐标)。 */
export interface PositionedTile extends ViewerTile {
  x: number;
  y: number;
}

/** viewer 的完整渲染输入。 */
export interface ViewerModel {
  entry: ViewerEntry;
  tiles: PositionedTile[];
  groups: ViewerGroup[];
}

/** 消费方注入:把不透明 ResourceRef 解析成可用于 iframe/img 的 URL。 */
export interface ResourceResolver {
  resolve(ref: ResourceRef): string;
}

/** 设计稿 tile 判定。 */
export function isDesignTile(tile: ViewerTile): boolean {
  return tile.kind === "design-page";
}
