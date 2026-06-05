/**
 * 键盘快捷键 Hook
 *
 * 任务 5.31: 实现快捷键支持
 *
 * 支持的快捷键：
 * - 空格键 + 拖拽：画布平移
 * - Cmd/Ctrl + Z：撤销
 * - Cmd/Ctrl + Shift + Z：重做
 * - Cmd/Ctrl + C：复制选中元素
 * - Cmd/Ctrl + V：粘贴
 * - Delete/Backspace：删除选中元素
 * - 方向键：微调选中元素位置
 * - +/-：缩放
 * - 0：适应屏幕
 * - F：切换全屏
 * - H：切换网格
 * - A：切换标注
 * - Escape：取消选择
 */

import { useEffect, useCallback, useState, useRef } from "react";

/**
 * 快捷键配置
 */
export interface ShortcutConfig {
  /** 是否启用撤销/重做 */
  enableHistory?: boolean;
  /** 是否启用复制/粘贴 */
  enableClipboard?: boolean;
  /** 是否启用删除 */
  enableDelete?: boolean;
  /** 是否启用方向键微调 */
  enableArrowKeys?: boolean;
  /** 是否启用缩放快捷键 */
  enableZoom?: boolean;
  /** 微调步长（像素） */
  arrowKeyStep?: number;
  /** Shift + 方向键微调步长 */
  arrowKeyStepLarge?: number;
}

/**
 * 快捷键回调
 */
export interface ShortcutCallbacks {
  /** 撤销 */
  onUndo?: () => void;
  /** 重做 */
  onRedo?: () => void;
  /** 复制 */
  onCopy?: () => void;
  /** 粘贴 */
  onPaste?: () => void;
  /** 删除 */
  onDelete?: () => void;
  /** 移动元素 */
  onMove?: (dx: number, dy: number) => void;
  /** 缩放 */
  onZoom?: (direction: "in" | "out") => void;
  /** 适应屏幕 */
  onFitToScreen?: () => void;
  /** 切换全屏 */
  onToggleFullscreen?: () => void;
  /** 切换网格 */
  onToggleGrid?: () => void;
  /** 切换标注 */
  onToggleAnnotations?: () => void;
  /** 取消选择 */
  onCancelSelection?: () => void;
  /** 全选 */
  onSelectAll?: () => void;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<ShortcutConfig> = {
  enableHistory: true,
  enableClipboard: true,
  enableDelete: true,
  enableArrowKeys: true,
  enableZoom: true,
  arrowKeyStep: 1,
  arrowKeyStepLarge: 10,
};

/**
 * 判断是否是 Mac 系统
 */
function isMac(): boolean {
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

/**
 * 获取修饰键状态
 */
function getModifiers(e: KeyboardEvent): {
  cmd: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
} {
  return {
    cmd: e.metaKey,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

/**
 * 无参数的快捷键 action 类型
 */
type NoParamShortcutAction =
  | "onUndo"
  | "onRedo"
  | "onCopy"
  | "onPaste"
  | "onDelete"
  | "onFitToScreen"
  | "onToggleFullscreen"
  | "onToggleGrid"
  | "onToggleAnnotations"
  | "onCancelSelection"
  | "onSelectAll";

/**
 * 键盘快捷键 Hook
 */
export function useKeyboardShortcuts(
  callbacks: ShortcutCallbacks,
  config: ShortcutConfig = {},
): {
  /** 是否处于拖拽模式（空格键按下） */
  isDraggingMode: boolean;
  /** 手动触发快捷键（仅支持无参数的回调） */
  triggerShortcut: (action: NoParamShortcutAction) => void;
} {
  const opts = { ...DEFAULT_CONFIG, ...config };
  const isMacOS = isMac();

  // 拖拽模式状态
  const [isDraggingMode, setIsDraggingMode] = useState(false);

  // 空格键按下状态
  const spacePressedRef = useRef(false);

  // 触发快捷键（仅支持无参数的回调）
  const triggerShortcut = useCallback(
    (action: NoParamShortcutAction) => {
      const callback = callbacks[action];
      if (callback) {
        callback();
      }
    },
    [callbacks],
  );

  // 键盘按下处理
  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      const { cmd, ctrl, shift } = getModifiers(e);
      const cmdOrCtrl = isMacOS ? cmd : ctrl;

      // 忽略输入框中的快捷键
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      // === 空格键拖拽模式 ===
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        spacePressedRef.current = true;
        setIsDraggingMode(true);
        return;
      }

      // === Escape 取消选择 ===
      if (e.code === "Escape") {
        callbacks.onCancelSelection?.();
        return;
      }

      // === 撤销/重做 ===
      if (opts.enableHistory && cmdOrCtrl) {
        if (e.code === "KeyZ" && !shift) {
          e.preventDefault();
          callbacks.onUndo?.();
          return;
        }
        if (e.code === "KeyZ" && shift) {
          e.preventDefault();
          callbacks.onRedo?.();
          return;
        }
        // Cmd/Ctrl + Y 也用于重做
        if (e.code === "KeyY") {
          e.preventDefault();
          callbacks.onRedo?.();
          return;
        }
      }

      // === 复制/粘贴 ===
      if (opts.enableClipboard && cmdOrCtrl) {
        if (e.code === "KeyC") {
          e.preventDefault();
          callbacks.onCopy?.();
          return;
        }
        if (e.code === "KeyV") {
          e.preventDefault();
          callbacks.onPaste?.();
          return;
        }
        // Cmd/Ctrl + X 剪切
        if (e.code === "KeyX") {
          e.preventDefault();
          callbacks.onCopy?.();
          callbacks.onDelete?.();
          return;
        }
        // Cmd/Ctrl + A 全选
        if (e.code === "KeyA") {
          e.preventDefault();
          callbacks.onSelectAll?.();
          return;
        }
      }

      // === 删除 ===
      if (opts.enableDelete && (e.code === "Delete" || e.code === "Backspace")) {
        e.preventDefault();
        callbacks.onDelete?.();
        return;
      }

      // === 方向键微调 ===
      if (opts.enableArrowKeys && !cmdOrCtrl) {
        const step = shift ? opts.arrowKeyStepLarge : opts.arrowKeyStep;
        let dx = 0;
        let dy = 0;

        switch (e.code) {
          case "ArrowLeft":
            dx = -step;
            break;
          case "ArrowRight":
            dx = step;
            break;
          case "ArrowUp":
            dy = -step;
            break;
          case "ArrowDown":
            dy = step;
            break;
        }

        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          callbacks.onMove?.(dx, dy);
          return;
        }
      }

      // === 缩放快捷键 ===
      if (opts.enableZoom) {
        // +/= 放大
        if (e.code === "Equal" || e.code === "NumpadAdd") {
          if (cmdOrCtrl) {
            e.preventDefault();
            callbacks.onZoom?.("in");
            return;
          }
        }

        // - 缩小
        if (e.code === "Minus" || e.code === "NumpadSubtract") {
          if (cmdOrCtrl) {
            e.preventDefault();
            callbacks.onZoom?.("out");
            return;
          }
        }

        // 0 适应屏幕
        if (e.code === "Digit0" || e.code === "Numpad0") {
          if (cmdOrCtrl) {
            e.preventDefault();
            callbacks.onFitToScreen?.();
            return;
          }
        }
      }

      // === 其他快捷键 ===
      if (!cmdOrCtrl && !shift && !e.altKey) {
        // F 切换全屏
        if (e.code === "KeyF") {
          e.preventDefault();
          callbacks.onToggleFullscreen?.();
          return;
        }

        // G 切换网格
        if (e.code === "KeyG") {
          e.preventDefault();
          callbacks.onToggleGrid?.();
          return;
        }

        // A 切换标注
        if (e.code === "KeyA") {
          e.preventDefault();
          callbacks.onToggleAnnotations?.();
          return;
        }
      }

      // 数字键缩放（无修饰键）
      if (!cmdOrCtrl && !shift) {
        if (e.code === "Digit1") {
          callbacks.onZoom?.("in");
          return;
        }
        if (e.code === "Digit2") {
          callbacks.onZoom?.("in");
          return;
        }
        if (e.code === "Digit3") {
          callbacks.onZoom?.("in");
          return;
        }
        if (e.code === "Digit4") {
          callbacks.onZoom?.("out");
          return;
        }
      }
    },
    [callbacks, opts, isMacOS],
  );

  // 键盘释放处理
  const handleKeyUp = useCallback((e: KeyboardEvent): void => {
    // 释放空格键
    if (e.code === "Space") {
      spacePressedRef.current = false;
      setIsDraggingMode(false);
    }
  }, []);

  // 注册事件监听
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return {
    isDraggingMode,
    triggerShortcut,
  };
}

/**
 * 快捷键项类型
 */
export interface ShortcutItem {
  key: string;
  description: string;
}

/**
 * 快捷键帮助信息
 */
export const SHORTCUT_HELP: ShortcutItem[] = [
  { key: "Space + Drag", description: "画布平移" },
  { key: "Cmd/Ctrl + Z", description: "撤销" },
  { key: "Cmd/Ctrl + Shift + Z", description: "重做" },
  { key: "Cmd/Ctrl + C", description: "复制" },
  { key: "Cmd/Ctrl + V", description: "粘贴" },
  { key: "Cmd/Ctrl + X", description: "剪切" },
  { key: "Cmd/Ctrl + A", description: "全选" },
  { key: "Delete / Backspace", description: "删除" },
  { key: "Arrow Keys", description: "微调位置 (1px)" },
  { key: "Shift + Arrow Keys", description: "大幅调整 (10px)" },
  { key: "Cmd/Ctrl + +/-", description: "缩放" },
  { key: "Cmd/Ctrl + 0", description: "适应屏幕" },
  { key: "F", description: "切换全屏" },
  { key: "G", description: "切换网格" },
  { key: "Escape", description: "取消选择" },
];
