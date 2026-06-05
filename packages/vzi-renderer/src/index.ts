export { CanvasKitSurface } from "./components/CanvasKitSurface";
export type {
  CanvasKitSurfaceProps,
  CanvasKitViewportState,
  FlatIRDocumentLike,
  FlatIRElementLike,
} from "./components/CanvasKitSurface";
export {
  buildCanvasKitElementTree,
  flattenCanvasKitElements,
} from "./components/CanvasKitSurface";
export { FocusedPreviewSurface } from "./components/FocusedPreviewSurface";
export type { FocusedPreviewSurfaceProps } from "./components/FocusedPreviewSurface";
export type { IRElement } from "./canvaskit/renderers/types";
export type {
  AnnotationTheme,
  PartialAnnotationStyleConfig,
  AnnotationStyleConfig,
} from "./canvaskit/annotations";
export {
  DEFAULT_ANNOTATION_STYLES,
  buildAnnotationStylesFromTheme,
  resolveAnnotationStyleConfig,
} from "./canvaskit/annotations";
export type {
  Annotation,
  AnnotationType,
  AlignmentAnnotation,
  ColorCategory,
  ColorToken,
  DimensionAnnotation,
  DistanceAnnotation,
  FontToken,
  GridAnnotation,
  SpacingAnnotation,
} from "./types/design-tokens";
