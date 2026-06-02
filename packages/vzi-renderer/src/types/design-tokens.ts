import type { IRBounds } from '@vzi-core/types'

export type ColorCategory =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'background'
  | 'text'
  | 'border'
  | 'other'

export interface ColorToken {
  value: string
  name?: string
  category: ColorCategory
  usage?: string
  frequency: number
  relatedTokens?: string[]
}

export interface FontToken {
  fontFamily: string
  fontWeight?: number
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
  usage?: string
  frequency: number
}

export type AnnotationType =
  | 'spacing'
  | 'alignment'
  | 'dimension'
  | 'grid'
  | 'distance'

export interface BaseAnnotation {
  id: string
  type: AnnotationType
  elementIds: string[]
  position: IRBounds
  value: string
}

export interface SpacingAnnotation extends BaseAnnotation {
  type: 'spacing'
  spacingType: 'margin' | 'padding' | 'gap'
  values: [number, number, number, number]
}

export interface AlignmentAnnotation extends BaseAnnotation {
  type: 'alignment'
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
}

export interface DimensionAnnotation extends BaseAnnotation {
  type: 'dimension'
  width: number
  height: number
}

export interface GridAnnotation extends BaseAnnotation {
  type: 'grid'
  columns: number
  rows: number
  columnWidths: number[]
  rowHeights: number[]
  gap: number
}

export interface DistanceAnnotation extends BaseAnnotation {
  type: 'distance'
  fromElementId: string
  toElementId: string
  distance: number
  direction: 'horizontal' | 'vertical'
}

export type Annotation =
  | SpacingAnnotation
  | AlignmentAnnotation
  | DimensionAnnotation
  | GridAnnotation
  | DistanceAnnotation
