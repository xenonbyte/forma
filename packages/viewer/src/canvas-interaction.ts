import type { PanOnScrollMode } from "@xyflow/react";

/** 画布交互手势:双指拖=平移,捏合/Cmd+滚轮=缩放,左键拖=平移(Figma 标准,对齐标注页)。
 *  panOnScrollMode 用字符串字面量 "free"(= PanOnScrollMode.Free)而非运行时枚举:
 *  type-only 导入只对齐类型,避免浏览器(Vite 预打包)端对 @xyflow/react 经 @xyflow/system
 *  的深层 re-export 做运行时按需解析时漏掉该具名导出。 */
export const CANVAS_INTERACTION_PROPS = {
  panOnScroll: true,
  panOnScrollMode: "free" as PanOnScrollMode,
  zoomOnScroll: false,
  zoomOnPinch: true,
  panOnDrag: true,
  zoomOnDoubleClick: false,
} as const;
