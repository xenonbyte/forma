export const FORMA_VIEWER_PACKAGE = "@xenonbyte/forma-viewer";

export type {
  ArtifactKind,
  CanvasMode,
  ViewerEntry,
  PreviewDensity,
  ResourceRef,
  PreviewImageRefs,
  ViewerTile,
  ViewerGroup,
  PositionedTile,
  ViewerModel,
  ResourceResolver
} from "./model.js";
export { isDesignTile } from "./model.js";
export { layoutTiles, TILE_GAP } from "./layout.js";
export { buildViewerModel } from "./normalize.js";
export type { NormalizeArtifactInput, BuildViewerModelInput } from "./normalize.js";
export { DesignTile } from "./tiles/DesignTile.js";
export type { DesignTileProps } from "./tiles/DesignTile.js";
export { AnnotationTile } from "./tiles/AnnotationTile.js";
export type { AnnotationTileProps } from "./tiles/AnnotationTile.js";
export { Canvas } from "./Canvas.js";
export type { CanvasProps } from "./Canvas.js";
export { DesignList } from "./DesignList.js";
export type { DesignListProps } from "./DesignList.js";
export { AnnotationSlot } from "./AnnotationSlot.js";
