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
