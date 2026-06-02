import React, { useMemo } from 'react';
import type { IRElement } from '../canvaskit/renderers/types';
import { flattenCanvasKitElements } from './CanvasKitSurface';
import { calculateMarkData, resolveAnnotationStyleConfig } from '../canvaskit/annotations';
import type {
  AnnotationStyleConfig,
  AnnotationTheme,
  DistanceData,
  ElementBounds,
  PartialAnnotationStyleConfig,
  RulerData,
} from '../canvaskit/annotations';

export interface SnapshotAnnotationOverlayProps {
  elements: IRElement[];
  width: number;
  height: number;
  visible?: boolean;
  selectedElementId?: string | null;
  hoveredElementId?: string | null;
  onSelectElement?: (element: IRElement | null) => void;
  onHoverElement?: (element: IRElement | null) => void;
  annotationTheme?: AnnotationTheme;
  annotationStyles?: PartialAnnotationStyleConfig;
  showLabels?: boolean;
  surfaceWidth?: number;
  surfaceHeight?: number;
  sceneScale?: number;
  sceneOffsetX?: number;
  sceneOffsetY?: number;
}

function toElementBounds(element: IRElement): ElementBounds {
  return {
    top: element.bounds.y,
    left: element.bounds.x,
    bottom: element.bounds.y + element.bounds.height,
    right: element.bounds.x + element.bounds.width,
    width: element.bounds.width,
    height: element.bounds.height,
  };
}

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6;
}

function snapToPixel(value: number): number {
  return Math.round(value * 2) / 2;
}

function worldToScreenX(x: number, sceneOffsetX: number, sceneScale: number): number {
  return sceneOffsetX + x * sceneScale;
}

function worldToScreenY(y: number, sceneOffsetY: number, sceneScale: number): number {
  return sceneOffsetY + y * sceneScale;
}

function worldToScreenWidth(value: number, sceneScale: number): number {
  return value * sceneScale;
}

function worldToScreenHeight(value: number, sceneScale: number): number {
  return value * sceneScale;
}

interface PillLabelDescriptor {
  testIdPrefix: string;
  text: string;
  x: number;
  y: number;
  background: string;
  color: string;
  fontSize: number;
  paddingH: number;
  paddingV: number;
  borderRadius: number;
  anchor?: 'center' | 'start';
}

interface PillLabelLayout {
  left: number;
  top: number;
  width: number;
  height: number;
  textAlign: 'center' | 'left';
}

function buildPillLabelLayout(options: PillLabelDescriptor): PillLabelLayout {
  const {
    text,
    x,
    y,
    fontSize,
    paddingH,
    paddingV,
    anchor = 'center',
  } = options;

  const textWidth = estimateTextWidth(text, fontSize);
  const labelWidth = snapToPixel(textWidth + paddingH * 2);
  const labelHeight = snapToPixel(fontSize + paddingV * 2);
  return {
    left: snapToPixel(anchor === 'center' ? x - labelWidth / 2 : x),
    top: snapToPixel(y),
    width: labelWidth,
    height: labelHeight,
    textAlign: anchor === 'center' ? 'center' : 'left',
  };
}

function renderPillLabel(options: PillLabelDescriptor) {
  const { testIdPrefix, text, background, color, fontSize, borderRadius, paddingH } = options;
  const layout = buildPillLabelLayout(options);
  return (
    <div
      key={testIdPrefix}
      data-testid={`${testIdPrefix}-group`}
      style={{
        position: 'absolute',
        left: `${layout.left}px`,
        top: `${layout.top}px`,
        width: `${layout.width}px`,
        height: `${layout.height}px`,
        borderRadius: `${borderRadius}px`,
        background,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: layout.textAlign === 'center' ? 'center' : 'flex-start',
        padding: `0 ${paddingH}px`,
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    >
      <div
        data-testid={`${testIdPrefix}-bg`}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: `${borderRadius}px`,
          background,
        }}
      />
      <span
        data-testid={`${testIdPrefix}-text`}
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: `${fontSize}px`,
          lineHeight: '1',
          fontWeight: 600,
          color,
          textAlign: layout.textAlign,
          width: '100%',
          whiteSpace: 'nowrap',
          WebkitFontSmoothing: 'antialiased',
          textRendering: 'geometricPrecision',
        }}
      >
        {text}
      </span>
    </div>
  );
}

function DistanceMarks({
  data,
  width,
  height,
  sceneScale,
  sceneOffsetX,
  sceneOffsetY,
  styles,
}: {
  data: DistanceData[];
  width: number;
  height: number;
  sceneScale: number;
  sceneOffsetX: number;
  sceneOffsetY: number;
  styles: AnnotationStyleConfig;
}) {
  const style = styles.distance;
  const capSize = 6;

  return (
    <g data-testid="snapshot-annotation-distance-marks" pointerEvents="none">
      {data.map((item, index) => {
        const x = snapToPixel(worldToScreenX(item.x * width, sceneOffsetX, sceneScale));
        const y = snapToPixel(worldToScreenY(item.y * height, sceneOffsetY, sceneScale));
        const labelText = `${Math.round(item.distance)}px`;

        if (item.w !== undefined) {
          const spanWidth = snapToPixel(worldToScreenWidth(item.w * width, sceneScale));
          return (
            <g key={`distance-h-${index}`}>
              <line x1={x} y1={y} x2={snapToPixel(x + spanWidth)} y2={y} stroke={style.strokeColor} strokeWidth={style.strokeWidth} vectorEffect="non-scaling-stroke" />
              <line x1={x} y1={snapToPixel(y - capSize)} x2={x} y2={snapToPixel(y + capSize)} stroke={style.strokeColor} strokeWidth={style.strokeWidth} vectorEffect="non-scaling-stroke" />
              <line x1={snapToPixel(x + spanWidth)} y1={snapToPixel(y - capSize)} x2={snapToPixel(x + spanWidth)} y2={snapToPixel(y + capSize)} stroke={style.strokeColor} strokeWidth={style.strokeWidth} vectorEffect="non-scaling-stroke" />
            </g>
          );
        }

        if (item.h !== undefined) {
          const spanHeight = snapToPixel(worldToScreenHeight(item.h * height, sceneScale));
          return (
            <g key={`distance-v-${index}`}>
              <line x1={x} y1={y} x2={x} y2={snapToPixel(y + spanHeight)} stroke={style.strokeColor} strokeWidth={style.strokeWidth} vectorEffect="non-scaling-stroke" />
              <line x1={snapToPixel(x - capSize)} y1={y} x2={snapToPixel(x + capSize)} y2={y} stroke={style.strokeColor} strokeWidth={style.strokeWidth} vectorEffect="non-scaling-stroke" />
              <line x1={snapToPixel(x - capSize)} y1={snapToPixel(y + spanHeight)} x2={snapToPixel(x + capSize)} y2={snapToPixel(y + spanHeight)} stroke={style.strokeColor} strokeWidth={style.strokeWidth} vectorEffect="non-scaling-stroke" />
            </g>
          );
        }

        return null;
      })}
    </g>
  );
}

function RulerMarks({
  data,
  width,
  height,
  sceneScale,
  sceneOffsetX,
  sceneOffsetY,
  styles,
}: {
  data: RulerData[];
  width: number;
  height: number;
  sceneScale: number;
  sceneOffsetX: number;
  sceneOffsetY: number;
  styles: AnnotationStyleConfig;
}) {
  const style = styles.ruler;
  const dashArray = style.dashArray.join(' ');

  return (
    <g data-testid="snapshot-annotation-ruler-marks" pointerEvents="none" opacity={style.opacity}>
      {data.map((item, index) => {
        const x = snapToPixel(worldToScreenX(item.x * width, sceneOffsetX, sceneScale));
        const y = snapToPixel(worldToScreenY(item.y * height, sceneOffsetY, sceneScale));

        if (item.w !== undefined) {
          return (
            <line
              key={`ruler-h-${index}`}
              x1={x}
              y1={y}
              x2={snapToPixel(x + worldToScreenWidth(item.w * width, sceneScale))}
              y2={y}
              stroke={style.strokeColor}
              strokeWidth={style.strokeWidth}
              strokeDasharray={dashArray}
              strokeOpacity={style.opacity}
              vectorEffect="non-scaling-stroke"
            />
          );
        }

        if (item.h !== undefined) {
          return (
            <line
              key={`ruler-v-${index}`}
              x1={x}
              y1={y}
              x2={x}
              y2={snapToPixel(y + worldToScreenHeight(item.h * height, sceneScale))}
              stroke={style.strokeColor}
              strokeWidth={style.strokeWidth}
              strokeDasharray={dashArray}
              strokeOpacity={style.opacity}
              vectorEffect="non-scaling-stroke"
            />
          );
        }

        return null;
      })}
    </g>
  );
}

function SelectionDimensionLabel({
  bounds,
  sceneScale,
  sceneOffsetX,
  sceneOffsetY,
  styles,
}: {
  bounds: ElementBounds;
  sceneScale: number;
  sceneOffsetX: number;
  sceneOffsetY: number;
  styles: AnnotationStyleConfig;
}) {
  const style = styles.selection;
  if (style.showDimensionLabel === false) {
    return null;
  }

  return renderPillLabel({
    testIdPrefix: 'snapshot-dimension-label',
    text: `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`,
    x: worldToScreenX(bounds.left + bounds.width / 2, sceneOffsetX, sceneScale),
    y: worldToScreenY(bounds.top + bounds.height, sceneOffsetY, sceneScale) + 8,
    background: style.dimensionLabelBgColor || style.strokeColor,
    color: style.dimensionLabelTextColor || '#ffffff',
    fontSize: style.dimensionLabelFontSize || 12,
    paddingH: style.dimensionLabelPadding?.[0] ?? 8,
    paddingV: style.dimensionLabelPadding?.[1] ?? 4,
    borderRadius: style.dimensionLabelBorderRadius || 4,
  });
}

export function SnapshotAnnotationOverlay({
  elements,
  width,
  height,
  visible = true,
  selectedElementId,
  hoveredElementId,
  onSelectElement,
  onHoverElement,
  annotationTheme,
  annotationStyles,
  showLabels = false,
  surfaceWidth,
  surfaceHeight,
  sceneScale = 1,
  sceneOffsetX = 0,
  sceneOffsetY = 0,
}: SnapshotAnnotationOverlayProps) {
  const flattenedElements = useMemo(
    () => flattenCanvasKitElements(elements).filter((element) => element.bounds.width > 0 && element.bounds.height > 0),
    [elements]
  );

  const elementById = useMemo(
    () => new Map(flattenedElements.map((element) => [element.id, element])),
    [flattenedElements]
  );

  const selectedElement = selectedElementId ? elementById.get(selectedElementId) ?? null : null;
  const hoveredElement = hoveredElementId ? elementById.get(hoveredElementId) ?? null : null;
  const selectedBounds = selectedElement ? toElementBounds(selectedElement) : null;
  const hoveredBounds = hoveredElement ? toElementBounds(hoveredElement) : null;
  const styles = useMemo(
    () => resolveAnnotationStyleConfig(annotationTheme, annotationStyles),
    [annotationTheme, annotationStyles]
  );

  const markData = useMemo(
    () => (selectedBounds && hoveredBounds && selectedElementId !== hoveredElementId
      ? calculateMarkData(selectedBounds, hoveredBounds, { width, height })
      : { distanceData: [], rulerData: [] }),
    [height, hoveredBounds, hoveredElementId, selectedBounds, selectedElementId, width]
  );

  const rulerData = useMemo<RulerData[]>(() => {
    if (markData.rulerData.length > 0) {
      return markData.rulerData;
    }
    return markData.distanceData.map((item) => ({
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      distance: item.distance,
    }));
  }, [markData.distanceData, markData.rulerData]);

  const distanceLabels = useMemo(
    () => markData.distanceData.map((item, index) => {
      const style = styles.distance;
      const x = snapToPixel(worldToScreenX(item.x * width, sceneOffsetX, sceneScale));
      const y = snapToPixel(worldToScreenY(item.y * height, sceneOffsetY, sceneScale));
      const text = `${Math.round(item.distance)}px`;

      if (item.w !== undefined) {
        const spanWidth = snapToPixel(worldToScreenWidth(item.w * width, sceneScale));
        const labelLayout = buildPillLabelLayout({
          testIdPrefix: `snapshot-distance-label-${index}`,
          text,
          x: x + spanWidth / 2,
          y: 0,
          background: style.labelBackgroundColor,
          color: style.labelTextColor,
          fontSize: style.labelFontSize,
          paddingH: style.labelPadding[0],
          paddingV: style.labelPadding[1],
          borderRadius: style.labelBorderRadius,
        });
        return renderPillLabel({
          testIdPrefix: `snapshot-distance-label-${index}`,
          text,
          x: x + spanWidth / 2,
          y: y - labelLayout.height / 2 - 8,
          background: style.labelBackgroundColor,
          color: style.labelTextColor,
          fontSize: style.labelFontSize,
          paddingH: style.labelPadding[0],
          paddingV: style.labelPadding[1],
          borderRadius: style.labelBorderRadius,
        });
      }

      if (item.h !== undefined) {
        const spanHeight = snapToPixel(worldToScreenHeight(item.h * height, sceneScale));
        return renderPillLabel({
          testIdPrefix: `snapshot-distance-label-${index}`,
          text,
          x: x + 8,
          y: y + spanHeight / 2 - (style.labelFontSize / 2 + style.labelPadding[1]),
          background: style.labelBackgroundColor,
          color: style.labelTextColor,
          fontSize: style.labelFontSize,
          paddingH: style.labelPadding[0],
          paddingV: style.labelPadding[1],
          borderRadius: style.labelBorderRadius,
          anchor: 'start',
        });
      }

      return null;
    }),
    [height, markData.distanceData, sceneOffsetX, sceneOffsetY, sceneScale, styles.distance, width]
  );

  const selectionDimensionLabel = useMemo(
    () => (selectedBounds ? (
      <SelectionDimensionLabel
        bounds={selectedBounds}
        sceneScale={sceneScale}
        sceneOffsetX={sceneOffsetX}
        sceneOffsetY={sceneOffsetY}
        styles={styles}
      />
    ) : null),
    [sceneOffsetX, sceneOffsetY, sceneScale, selectedBounds, styles]
  );

  if (!visible) {
    return null;
  }

  return (
    <div
      data-testid="snapshot-annotation-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        touchAction: 'none',
      }}
    >
      <svg
        data-testid="snapshot-annotation-overlay-svg"
        width={surfaceWidth ?? width}
        height={surfaceHeight ?? height}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        {rulerData.length > 0 ? (
          <RulerMarks
            data={rulerData}
            width={width}
            height={height}
            sceneScale={sceneScale}
            sceneOffsetX={sceneOffsetX}
            sceneOffsetY={sceneOffsetY}
            styles={styles}
          />
        ) : null}
        {markData.distanceData.length > 0 ? (
          <DistanceMarks
            data={markData.distanceData}
            width={width}
            height={height}
            sceneScale={sceneScale}
            sceneOffsetX={sceneOffsetX}
            sceneOffsetY={sceneOffsetY}
            styles={styles}
          />
        ) : null}

        {flattenedElements.map((element) => {
          const isSelected = selectedElementId === element.id;
          const isHovered = hoveredElementId === element.id;
          const showOutline = isSelected || isHovered;
          const stroke = isSelected
            ? styles.selection.strokeColor
            : styles.hover.strokeColor;
          const label = element.textContent?.trim() || element.id;
          const x = snapToPixel(worldToScreenX(element.bounds.x, sceneOffsetX, sceneScale));
          const y = snapToPixel(worldToScreenY(element.bounds.y, sceneOffsetY, sceneScale));
          const elementWidth = snapToPixel(worldToScreenWidth(element.bounds.width, sceneScale));
          const elementHeight = snapToPixel(worldToScreenHeight(element.bounds.height, sceneScale));

          return (
            <g
              key={element.id}
              data-testid={`snapshot-annotation-${element.id}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectElement?.(element);
              }}
              onMouseOver={() => onHoverElement?.(element)}
              onMouseOut={() => onHoverElement?.(null)}
              style={{ cursor: onSelectElement ? 'pointer' : 'default' }}
              pointerEvents="none"
            >
              <rect
                data-testid={`snapshot-hitbox-${element.id}`}
                data-vzi-overlay-hit="true"
                x={x}
                y={y}
                width={elementWidth}
                height={elementHeight}
                fill="transparent"
                stroke="transparent"
                pointerEvents="all"
                style={{ touchAction: 'none' }}
              />
              {showOutline ? (
                <rect
                  data-testid={`snapshot-outline-${element.id}`}
                  x={x}
                  y={y}
                  width={elementWidth}
                  height={elementHeight}
                  fill="transparent"
                  stroke={stroke}
                  strokeWidth={isSelected ? styles.selection.strokeWidth : styles.hover.strokeWidth}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                  shapeRendering="geometricPrecision"
                />
              ) : null}
              {showLabels ? (
                <text x={snapToPixel(x + 6)} y={snapToPixel(y + 16)} fontSize="12" fontWeight="600" fill={showOutline ? stroke : '#64748b'} pointerEvents="none" style={{ textRendering: 'geometricPrecision' }}>
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <div
        data-testid="snapshot-annotation-overlay-labels"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {distanceLabels}
        {selectionDimensionLabel}
      </div>
    </div>
  );
}
