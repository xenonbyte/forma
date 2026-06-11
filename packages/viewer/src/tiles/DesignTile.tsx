import { useRef } from "react";

import type { PositionedTile, ResourceResolver } from "../model.js";

export interface DesignTileProps {
  tile: PositionedTile;
  resolver: ResourceResolver;
  interactive?: boolean;
  scrollable?: boolean;
}

/**
 * 设计画布瓦片:在沙箱 iframe 里渲染自包含静态 HTML。
 * sandbox 明确不含 allow-scripts —— 设计稿是纯静态产物,禁止脚本执行。
 */
export function DesignTile({ tile, resolver, interactive = true, scrollable = false }: DesignTileProps): React.ReactElement {
  const src = resolver.resolve(tile.htmlBundle);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);

  function scrollIframeBy(left: number, top: number): void {
    if (left === 0 && top === 0) return;
    try {
      iframeRef.current?.contentWindow?.scrollBy({ left, top, behavior: "auto" });
    } catch {
      // Cross-origin bundle URLs cannot be programmatically scrolled; keep the preview non-clickable.
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    scrollIframeBy(event.deltaX, event.deltaY);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    scrollIframeBy(drag.clientX - event.clientX, drag.clientY - event.clientY);
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
  }

  function endPointerScroll(event: React.PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div style={{ position: "relative", width: tile.width, height: tile.height, lineHeight: 0 }}>
      <iframe
        ref={iframeRef}
        title={tile.title}
        src={src}
        width={tile.width}
        height={tile.height}
        // allow-same-origin and allow-scripts must never coexist: a framed
        // document with both can remove its own sandbox attribute, making
        // the sandbox effectively meaningless. We include allow-same-origin
        // for resource loading but explicitly omit allow-scripts and allow-forms.
        sandbox="allow-same-origin"
        style={{
          border: "none",
          display: "block",
          background: "#fff",
          pointerEvents: interactive && !scrollable ? "auto" : "none",
        }}
      />
      {scrollable && (
        <div
          aria-hidden="true"
          data-testid="design-tile-scroll-proxy"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointerScroll}
          onPointerCancel={endPointerScroll}
          style={{ position: "absolute", inset: 0, touchAction: "none" }}
        />
      )}
    </div>
  );
}
