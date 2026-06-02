import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { DesignSnapshotManifest } from '@vzi-core/types';

export type VZIRenderMode = 'full' | 'tile';

export interface VZIViewportState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface VZIRendererProps {
  manifest: DesignSnapshotManifest;
  fullImageSrc?: string;
  resolveImageSrc?: (path: string) => string;
  renderMode?: VZIRenderMode;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  alt?: string;
  overlay?: ReactNode;
  children?: ReactNode;
  showBoundsOverlay?: boolean;
  overlayPointerEvents?: CSSProperties['pointerEvents'];
  interactive?: boolean;
  panOnPrimaryDrag?: boolean;
  minScale?: number;
  maxScale?: number;
  viewport?: VZIViewportState;
  defaultViewport?: VZIViewportState;
  onViewportChange?: (viewport: VZIViewportState) => void;
}

interface PointerDragState {
  pointerId: number;
  originX: number;
  originY: number;
  viewport: VZIViewportState;
  startedOnOverlayHit: boolean;
}

interface TouchGestureState {
  midpointX: number;
  midpointY: number;
  distance: number;
}

const DEFAULT_VIEWPORT: VZIViewportState = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDimension(value: number | string | undefined, fallback: string): string {
  if (typeof value === 'number') {
    return `${value}px`;
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return fallback;
}

function resolveSnapshotImagePath(
  manifest: DesignSnapshotManifest,
  fullImageSrc: string | undefined,
  resolveImageSrc: ((path: string) => string) | undefined
): string {
  if (fullImageSrc) {
    return fullImageSrc;
  }
  const sourcePath = manifest.fullImage.path;
  return resolveImageSrc ? resolveImageSrc(sourcePath) : sourcePath;
}

function resolveTilePath(path: string, resolveImageSrc?: (path: string) => string): string {
  return resolveImageSrc ? resolveImageSrc(path) : path;
}

function BoundsOverlay({ manifest }: { manifest: DesignSnapshotManifest }) {
  const { contentBounds, fullImage } = manifest;

  return (
    <svg
      data-testid="vzi-renderer-bounds-overlay"
      viewBox={`0 0 ${fullImage.width} ${fullImage.height}`}
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <rect
        x={contentBounds.x}
        y={contentBounds.y}
        width={contentBounds.width}
        height={contentBounds.height}
        fill="rgba(37, 99, 235, 0.08)"
        stroke="#2563eb"
        strokeWidth="2"
        strokeDasharray="10 6"
      />
    </svg>
  );
}

export const VZIRenderer = memo(function VZIRenderer({
  manifest,
  fullImageSrc,
  resolveImageSrc,
  renderMode = 'full',
  width = '100%',
  height,
  className,
  style,
  alt = 'VZI snapshot',
  overlay,
  children,
  showBoundsOverlay = false,
  overlayPointerEvents = 'none',
  interactive = false,
  panOnPrimaryDrag = true,
  minScale = 0.5,
  maxScale = 4,
  viewport,
  defaultViewport = DEFAULT_VIEWPORT,
  onViewportChange,
}: VZIRendererProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: manifest.fullImage.width, height: manifest.fullImage.height });
  const [uncontrolledViewport, setUncontrolledViewport] = useState<VZIViewportState>(defaultViewport);
  const controlledViewport = viewport ?? uncontrolledViewport;
  const viewportStateRef = useRef<VZIViewportState>(controlledViewport);
  const dragStateRef = useRef<PointerDragState | null>(null);
  const isDraggingRef = useRef(false);
  const suppressOverlayClickRef = useRef(false);
  const touchTapStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchTapMovedRef = useRef(false);
  const touchGestureRef = useRef<TouchGestureState | null>(null);

  useEffect(() => {
    setUncontrolledViewport(defaultViewport);
  }, [defaultViewport.offsetX, defaultViewport.offsetY, defaultViewport.scale]);

  useEffect(() => {
    viewportStateRef.current = controlledViewport;
  }, [controlledViewport]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const updateSize = (nextWidth: number, nextHeight: number) => {
      setFrameSize((prev) => {
        const widthChanged = Math.abs(prev.width - nextWidth) > 0.5;
        const heightChanged = Math.abs(prev.height - nextHeight) > 0.5;
        if (!widthChanged && !heightChanged) {
          return prev;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    const rect = frame.getBoundingClientRect();
    updateSize(Math.max(1, rect.width), Math.max(1, rect.height));

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateSize(Math.max(1, entry.contentRect.width), Math.max(1, entry.contentRect.height));
      }
    });
    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, []);

  const commitViewport = useCallback((nextViewport: VZIViewportState) => {
    if (viewport === undefined) {
      setUncontrolledViewport(nextViewport);
    }
    onViewportChange?.(nextViewport);
  }, [onViewportChange, viewport]);

  const updateViewport = useCallback((updater: (prev: VZIViewportState) => VZIViewportState) => {
    commitViewport(updater(viewportStateRef.current));
  }, [commitViewport]);

  const resolvedFullImageSrc = useMemo(
    () => resolveSnapshotImagePath(manifest, fullImageSrc, resolveImageSrc),
    [fullImageSrc, manifest, resolveImageSrc]
  );

  const resolvedTiles = useMemo(
    () => manifest.tiles.map((tile) => ({
      ...tile,
      resolvedPath: resolveTilePath(tile.path, resolveImageSrc),
    })),
    [manifest.tiles, resolveImageSrc]
  );

  const frameStyle: CSSProperties = {
    position: 'relative',
    width: formatDimension(width, '100%'),
    height: height === undefined ? 'auto' : formatDimension(height, 'auto'),
    aspectRatio: `${manifest.fullImage.width} / ${manifest.fullImage.height}`,
    overflow: 'hidden',
    background: manifest.background.color,
    touchAction: interactive ? 'none' : undefined,
    ...style,
  };

  const fitScale = useMemo(
    () => Math.min(frameSize.width / manifest.fullImage.width, frameSize.height / manifest.fullImage.height),
    [frameSize.height, frameSize.width, manifest.fullImage.height, manifest.fullImage.width]
  );
  const safeFitScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
  const contentWidth = manifest.fullImage.width * safeFitScale * controlledViewport.scale;
  const contentHeight = manifest.fullImage.height * safeFitScale * controlledViewport.scale;
  const fitOffsetX = (frameSize.width - manifest.fullImage.width * safeFitScale) / 2;
  const fitOffsetY = (frameSize.height - manifest.fullImage.height * safeFitScale) / 2;
  const translateX = fitOffsetX + controlledViewport.offsetX;
  const translateY = fitOffsetY + controlledViewport.offsetY;
  const sceneTransform = `translate(${translateX}px, ${translateY}px) scale(${safeFitScale * controlledViewport.scale})`;

  const resolveZoomAnchor = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current;
    if (!frame) {
      return null;
    }
    const rect = frame.getBoundingClientRect();
    const isInside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    return {
      localX: isInside ? clientX - rect.left : rect.width / 2,
      localY: isInside ? clientY - rect.top : rect.height / 2,
    };
  }, []);

  const zoomViewport = useCallback((baseViewport: VZIViewportState, clientX: number, clientY: number, nextScale: number) => {
    const anchor = resolveZoomAnchor(clientX, clientY);
    if (!anchor) {
      return baseViewport;
    }
    const currentScale = safeFitScale * baseViewport.scale;
    const nextCommittedScale = clamp(nextScale, minScale, maxScale);
    const nextAbsoluteScale = safeFitScale * nextCommittedScale;
    const worldX = (anchor.localX - fitOffsetX - baseViewport.offsetX) / currentScale;
    const worldY = (anchor.localY - fitOffsetY - baseViewport.offsetY) / currentScale;
    return {
      scale: nextCommittedScale,
      offsetX: anchor.localX - fitOffsetX - worldX * nextAbsoluteScale,
      offsetY: anchor.localY - fitOffsetY - worldY * nextAbsoluteScale,
    };
  }, [fitOffsetX, fitOffsetY, maxScale, minScale, resolveZoomAnchor, safeFitScale]);

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!interactive) {
      return;
    }
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const scaleFactor = 1 - event.deltaY * 0.01;
      updateViewport((prev) => zoomViewport(prev, event.clientX, event.clientY, prev.scale * scaleFactor));
      return;
    }
    updateViewport((prev) => ({
      ...prev,
      offsetX: prev.offsetX - event.deltaX,
      offsetY: prev.offsetY - event.deltaY,
    }));
  }, [interactive, updateViewport, zoomViewport]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !panOnPrimaryDrag || event.button != 0) {
      return;
    }

    let startedOnOverlayHit = false;
    const target = event.target;
    if (target instanceof Element) {
      const overlayHit = target.closest('[data-vzi-overlay-hit="true"]');
      if (overlayHit) {
        startedOnOverlayHit = true;
      }
    }

    isDraggingRef.current = false;
    dragStateRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      viewport: controlledViewport,
      startedOnOverlayHit,
    };
  }, [controlledViewport, interactive, panOnPrimaryDrag]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - dragState.originX;
    const dy = event.clientY - dragState.originY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (!isDraggingRef.current && distance <= 3) {
      return;
    }

    if (!isDraggingRef.current) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    isDraggingRef.current = true;
    commitViewport({
      ...dragState.viewport,
      offsetX: dragState.viewport.offsetX + dx,
      offsetY: dragState.viewport.offsetY + dy,
    });
  }, [commitViewport]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      if (isDraggingRef.current && dragStateRef.current.startedOnOverlayHit) {
        suppressOverlayClickRef.current = true;
        window.setTimeout(() => {
          suppressOverlayClickRef.current = false;
        }, 120);
      }
      isDraggingRef.current = false;
      dragStateRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleTouchStart = useCallback((event: TouchEvent) => {
    if (!interactive) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchTapStartRef.current = { x: touch.clientX, y: touch.clientY };
      touchTapMovedRef.current = false;
      touchGestureRef.current = null;
      return;
    }
    if (event.touches.length === 2) {
      const [firstTouch, secondTouch] = Array.from(event.touches);
      touchTapStartRef.current = null;
      touchTapMovedRef.current = false;
      touchGestureRef.current = {
        midpointX: (firstTouch.clientX + secondTouch.clientX) / 2,
        midpointY: (firstTouch.clientY + secondTouch.clientY) / 2,
        distance: Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY),
      };
    }
  }, [interactive]);

  const handleTouchMove = useCallback((event: TouchEvent) => {
    if (!interactive) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    if (event.touches.length === 1 && touchTapStartRef.current) {
      const touch = event.touches[0];
      const totalDx = touch.clientX - touchTapStartRef.current.x;
      const totalDy = touch.clientY - touchTapStartRef.current.y;
      const totalDistance = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
      if (totalDistance > 4) {
        touchTapMovedRef.current = true;
      }
      return;
    }
    if (event.touches.length !== 2 || !touchGestureRef.current) {
      return;
    }
    const [firstTouch, secondTouch] = Array.from(event.touches);
    const midpointX = (firstTouch.clientX + secondTouch.clientX) / 2;
    const midpointY = (firstTouch.clientY + secondTouch.clientY) / 2;
    const distance = Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY);
    const lastGesture = touchGestureRef.current;
    const deltaX = midpointX - lastGesture.midpointX;
    const deltaY = midpointY - lastGesture.midpointY;
    const scaleFactor = lastGesture.distance > 0 ? distance / lastGesture.distance : 1;

    updateViewport((prev) => {
      const pannedViewport = {
        ...prev,
        offsetX: prev.offsetX + deltaX,
        offsetY: prev.offsetY + deltaY,
      };
      if (!Number.isFinite(scaleFactor) || Math.abs(scaleFactor - 1) < 0.001) {
        return pannedViewport;
      }
      return zoomViewport(pannedViewport, midpointX, midpointY, pannedViewport.scale * scaleFactor);
    });

    touchGestureRef.current = {
      midpointX,
      midpointY,
      distance,
    };
  }, [interactive, updateViewport, zoomViewport]);

  const handleTouchEnd = useCallback((event: TouchEvent) => {
    if (!interactive) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    if (event.touches.length < 2) {
      touchGestureRef.current = null;
    }
    if (event.touches.length === 0) {
      touchTapStartRef.current = null;
      touchTapMovedRef.current = false;
    }
  }, [interactive]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !interactive) {
      return;
    }

    frame.addEventListener('wheel', handleWheel, { passive: false });
    frame.addEventListener('touchstart', handleTouchStart, { passive: false });
    frame.addEventListener('touchmove', handleTouchMove, { passive: false });
    frame.addEventListener('touchend', handleTouchEnd, { passive: false });
    frame.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    return () => {
      frame.removeEventListener('wheel', handleWheel);
      frame.removeEventListener('touchstart', handleTouchStart);
      frame.removeEventListener('touchmove', handleTouchMove);
      frame.removeEventListener('touchend', handleTouchEnd);
      frame.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleTouchEnd, handleTouchMove, handleTouchStart, handleWheel, interactive]);

  return (
    <div
      ref={frameRef}
      className={className}
      data-testid="vzi-renderer"
      data-render-mode={renderMode}
      data-revision={manifest.revision}
      data-interactive={String(interactive)}
      style={frameStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div
        data-testid="vzi-renderer-scene"
        data-scale={String(controlledViewport.scale)}
        data-offset-x={String(controlledViewport.offsetX)}
        data-offset-y={String(controlledViewport.offsetY)}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${manifest.fullImage.width}px`,
          height: `${manifest.fullImage.height}px`,
          transformOrigin: '0 0',
          transform: sceneTransform,
          willChange: interactive ? 'transform' : undefined,
        }}
      >
        {renderMode === 'tile' ? (
          <div data-testid="vzi-renderer-tiles" style={{ position: 'absolute', inset: 0 }}>
            {resolvedTiles.map((tile) => (
              <img
                key={tile.id}
                data-testid={`vzi-renderer-tile-${tile.id}`}
                src={tile.resolvedPath}
                alt={`${alt} ${tile.id}`}
                draggable={false}
                style={{
                  position: 'absolute',
                  left: `${tile.x}px`,
                  top: `${tile.y}px`,
                  width: `${tile.width}px`,
                  height: `${tile.height}px`,
                  objectFit: 'fill',
                  display: 'block',
                  userSelect: 'none',
                  pointerEvents: 'none',
                }}
              />
            ))}
          </div>
        ) : (
          <img
            data-testid="vzi-renderer-full-image"
            src={resolvedFullImageSrc}
            alt={alt}
            draggable={false}
            style={{
              position: 'absolute',
              inset: 0,
              width: `${manifest.fullImage.width}px`,
              height: `${manifest.fullImage.height}px`,
              objectFit: 'fill',
              display: 'block',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
        )}

        {showBoundsOverlay ? <BoundsOverlay manifest={manifest} /> : null}
        {children ? (
          <div data-testid="vzi-renderer-children" style={{ position: 'absolute', inset: 0 }}>
            {children}
          </div>
        ) : null}
      </div>

      {overlay ? (
        <div
          data-testid="vzi-renderer-overlay"
          data-vzi-overlay-interactive={overlayPointerEvents === 'none' ? 'false' : 'true'}
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: overlayPointerEvents,
            touchAction: interactive ? 'none' : undefined,
          }}
          onClickCapture={(event) => {
            if (suppressOverlayClickRef.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          {overlay}
        </div>
      ) : null}

      {interactive ? (
        <div
          data-testid="vzi-renderer-viewport-meta"
          style={{ display: 'none' }}
          data-content-width={String(contentWidth)}
          data-content-height={String(contentHeight)}
        />
      ) : null}
    </div>
  );
});
