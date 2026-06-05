/**
 * 图层面板组件
 *
 * 任务 5.26: 实现树形结构、拖拽排序的图层面板
 */

import { useState, useMemo, useCallback, memo } from "react";
import type { IRElement } from "@vzi-core/types";

/**
 * 图层面板属性
 */
export interface LayerPanelProps {
  /** 元素映射 */
  elements: Record<string, IRElement>;
  /** 根元素 ID */
  rootElementId: string;
  /** 当前选中的元素 ID */
  selectedElementId: string | null;
  /** 当前悬停的元素 ID */
  hoveredElementId: string | null;
  /** 元素选中回调 */
  onElementSelect?: (elementId: string | null) => void;
  /** 元素悬停回调 */
  onElementHover?: (elementId: string | null) => void;
  /** 元素顺序变更回调 */
  onReorder?: (elementId: string, newParentId: string | null, newIndex: number) => void;
  /** 元素可见性变更回调 */
  onVisibilityChange?: (elementId: string, visible: boolean) => void;
  /** 元素锁定变更回调 */
  onLockChange?: (elementId: string, locked: boolean) => void;
}

/**
 * 图层项数据
 */
interface LayerItem {
  element: IRElement;
  depth: number;
  children: LayerItem[];
  isExpanded: boolean;
  isVisible: boolean;
  isLocked: boolean;
}

/**
 * 拖拽状态
 */
interface DragState {
  draggedId: string | null;
  dropTargetId: string | null;
  dropPosition: "before" | "after" | "inside" | null;
}

/**
 * 图层项样式
 */
const LAYER_STYLES = {
  indentWidth: 16,
  itemHeight: 28,
  selectedBg: "rgba(0, 102, 255, 0.15)",
  hoveredBg: "rgba(0, 102, 255, 0.08)",
  dragOverBg: "rgba(0, 102, 255, 0.25)",
  textColor: "#333333",
  textColorDisabled: "#999999",
  fontSize: 12,
};

/**
 * 元素类型图标
 */
const ELEMENT_ICONS: Record<string, string> = {
  container: "📦",
  text: "📝",
  image: "🖼️",
  button: "🔘",
  input: "✏️",
  link: "🔗",
};

/**
 * 获取元素显示名称
 */
function getElementName(element: IRElement): string {
  // 优先使用 source 中的语义名称
  if (element.source?.id) {
    return `#${element.source.id}`;
  }
  if (element.source?.className) {
    return `.${element.source.className.split(" ")[0]}`;
  }
  // 使用文本内容（截断）
  if (element.textContent) {
    const text = element.textContent.trim().slice(0, 20);
    return text.length < element.textContent.trim().length ? `${text}...` : text;
  }
  // 默认使用类型 + ID
  return `${element.type}:${element.id.slice(0, 6)}`;
}

/**
 * 构建图层树
 */
function buildLayerTree(
  elements: Record<string, IRElement>,
  rootId: string,
  depth: number = 0,
  expandedIds: Set<string>,
  visited: Set<string> = new Set(),
): LayerItem[] {
  // 循环引用保护
  if (visited.has(rootId)) return [];
  visited.add(rootId);

  const root = elements[rootId];
  if (!root) return [];

  // 找到直接子元素
  const children = Object.values(elements)
    .filter((el) => el.parentId === rootId)
    .sort((a, b) => {
      // 按 y 坐标排序，同 y 按 x 排序
      if (a.bounds.y !== b.bounds.y) return a.bounds.y - b.bounds.y;
      return a.bounds.x - b.bounds.x;
    });

  const item: LayerItem = {
    element: root,
    depth,
    children: children.flatMap((child) => buildLayerTree(elements, child.id, depth + 1, expandedIds, visited)),
    isExpanded: expandedIds.has(rootId),
    isVisible: true,
    isLocked: false,
  };

  return [item];
}

/**
 * 扁平化图层树为列表
 */
function flattenLayerTree(items: LayerItem[]): LayerItem[] {
  const result: LayerItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.isExpanded) {
      result.push(...flattenLayerTree(item.children));
    }
  }
  return result;
}

/**
 * 图层项渲染器属性
 */
interface LayerItemRendererProps {
  item: LayerItem;
  isSelected: boolean;
  isHovered: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  dropPosition: "before" | "after" | "inside" | null;
  onSelect: () => void;
  onHover: (isHovered: boolean) => void;
  onToggleExpand: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

/**
 * 单个图层项组件
 */
const LayerItemRenderer = memo<LayerItemRendererProps>(
  ({
    item,
    isSelected,
    isHovered,
    isDragging,
    isDropTarget,
    dropPosition,
    onSelect,
    onHover,
    onToggleExpand,
    onToggleVisibility,
    onToggleLock,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  }) => {
    const { element, depth, children, isExpanded, isVisible, isLocked } = item;
    const hasChildren = children.length > 0;

    const bgColor = isSelected
      ? LAYER_STYLES.selectedBg
      : isDropTarget
        ? LAYER_STYLES.dragOverBg
        : isHovered
          ? LAYER_STYLES.hoveredBg
          : "transparent";

    const textColor = isVisible ? LAYER_STYLES.textColor : LAYER_STYLES.textColorDisabled;

    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: LAYER_STYLES.itemHeight,
          paddingLeft: depth * LAYER_STYLES.indentWidth,
          paddingRight: 8,
          backgroundColor: bgColor,
          cursor: "pointer",
          opacity: isDragging ? 0.5 : 1,
          borderBottom: dropPosition === "after" ? "2px solid #0066ff" : "none",
          borderTop: dropPosition === "before" ? "2px solid #0066ff" : "none",
          userSelect: "none",
        }}
        onClick={onSelect}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* 展开/折叠按钮 */}
        <div
          style={{
            width: 16,
            height: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 4,
            cursor: hasChildren ? "pointer" : "default",
            color: "#666",
            fontSize: 10,
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleExpand();
          }}
        >
          {hasChildren ? (isExpanded ? "▼" : "▶") : ""}
        </div>

        {/* 元素类型图标 */}
        <span style={{ marginRight: 6, fontSize: 14 }}>{ELEMENT_ICONS[element.type] || "📦"}</span>

        {/* 元素名称 */}
        <span
          style={{
            flex: 1,
            fontSize: LAYER_STYLES.fontSize,
            color: textColor,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {getElementName(element)}
        </span>

        {/* 操作按钮 */}
        <div style={{ display: "flex", gap: 4 }}>
          {/* 可见性按钮 */}
          <button
            style={{
              width: 20,
              height: 20,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 12,
              opacity: isVisible ? 1 : 0.5,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility();
            }}
            title={isVisible ? "隐藏" : "显示"}
          >
            {isVisible ? "👁️" : "👁️‍🗨️"}
          </button>

          {/* 锁定按钮 */}
          <button
            style={{
              width: 20,
              height: 20,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 12,
              opacity: isLocked ? 1 : 0.3,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock();
            }}
            title={isLocked ? "解锁" : "锁定"}
          >
            {isLocked ? "🔒" : "🔓"}
          </button>
        </div>
      </div>
    );
  },
);

LayerItemRenderer.displayName = "LayerItemRenderer";

/**
 * 图层面板主组件
 */
export const LayerPanel: React.FC<LayerPanelProps> = memo(
  ({
    elements,
    rootElementId,
    selectedElementId,
    hoveredElementId,
    onElementSelect,
    onElementHover,
    onReorder,
    onVisibilityChange,
    onLockChange,
  }) => {
    // 展开状态
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set([rootElementId]));

    // 拖拽状态
    const [dragState, setDragState] = useState<DragState>({
      draggedId: null,
      dropTargetId: null,
      dropPosition: null,
    });

    // 元素可见性状态
    const [visibilityMap, setVisibilityMap] = useState<Record<string, boolean>>({});

    // 元素锁定状态
    const [lockMap, setLockMap] = useState<Record<string, boolean>>({});

    // 构建图层树
    const layerTree = useMemo(() => {
      return buildLayerTree(elements, rootElementId, 0, expandedIds);
    }, [elements, rootElementId, expandedIds]);

    // 扁平化列表
    const flatList = useMemo(() => {
      return flattenLayerTree(layerTree).map((item) => ({
        ...item,
        isVisible: visibilityMap[item.element.id] !== false,
        isLocked: lockMap[item.element.id] === true,
      }));
    }, [layerTree, visibilityMap, lockMap]);

    // 切换展开状态
    const handleToggleExpand = useCallback((elementId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(elementId)) {
          next.delete(elementId);
        } else {
          next.add(elementId);
        }
        return next;
      });
    }, []);

    // 切换可见性
    const handleToggleVisibility = useCallback(
      (elementId: string) => {
        setVisibilityMap((prev) => ({
          ...prev,
          [elementId]: prev[elementId] !== false,
        }));
        onVisibilityChange?.(elementId, visibilityMap[elementId] === false);
      },
      [onVisibilityChange, visibilityMap],
    );

    // 切换锁定
    const handleToggleLock = useCallback(
      (elementId: string) => {
        setLockMap((prev) => ({
          ...prev,
          [elementId]: prev[elementId] !== true,
        }));
        onLockChange?.(elementId, lockMap[elementId] !== true);
      },
      [onLockChange, lockMap],
    );

    // 拖拽开始
    const handleDragStart = useCallback(
      (elementId: string) => (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", elementId);
        setDragState({
          draggedId: elementId,
          dropTargetId: null,
          dropPosition: null,
        });
      },
      [],
    );

    // 拖拽结束
    const handleDragEnd = useCallback(() => {
      setDragState({
        draggedId: null,
        dropTargetId: null,
        dropPosition: null,
      });
    }, []);

    // 拖拽悬停
    const handleDragOver = useCallback(
      (elementId: string) => (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        const rect = (e.target as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        let position: "before" | "after" | "inside";
        if (y < height * 0.25) {
          position = "before";
        } else if (y > height * 0.75) {
          position = "after";
        } else {
          position = "inside";
        }

        setDragState((prev) => ({
          ...prev,
          dropTargetId: elementId,
          dropPosition: position,
        }));
      },
      [],
    );

    // 拖拽离开
    const handleDragLeave = useCallback(() => {
      setDragState((prev) => ({
        ...prev,
        dropTargetId: null,
        dropPosition: null,
      }));
    }, []);

    // 放置
    const handleDrop = useCallback(
      (targetId: string) => (e: React.DragEvent) => {
        e.preventDefault();

        const draggedId = e.dataTransfer.getData("text/plain");
        if (!draggedId || draggedId === targetId) return;

        const { dropPosition } = dragState;
        if (!dropPosition) return;

        // 计算新的父元素和索引
        let newParentId: string | null;
        let newIndex: number;

        if (dropPosition === "inside") {
          // 放入目标元素内部
          newParentId = targetId;
          // 计算目标元素的子元素数量作为新索引
          const targetChildren = Object.values(elements).filter((el) => el.parentId === targetId);
          newIndex = targetChildren.length;
        } else {
          // 放在目标元素前面或后面
          const targetElement = elements[targetId];
          newParentId = targetElement.parentId;

          // 获取同级元素列表并按位置排序
          const siblings = Object.values(elements)
            .filter((el) => el.parentId === newParentId)
            .sort((a, b) => {
              if (a.bounds.y !== b.bounds.y) return a.bounds.y - b.bounds.y;
              return a.bounds.x - b.bounds.x;
            });

          // 找到目标元素的索引
          const targetIndex = siblings.findIndex((el) => el.id === targetId);

          // 根据放置位置计算新索引
          if (dropPosition === "before") {
            newIndex = targetIndex;
          } else {
            newIndex = targetIndex + 1;
          }
        }

        onReorder?.(draggedId, newParentId, newIndex);

        setDragState({
          draggedId: null,
          dropTargetId: null,
          dropPosition: null,
        });
      },
      [elements, dragState, onReorder],
    );

    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "auto",
          backgroundColor: "#ffffff",
          border: "1px solid #e0e0e0",
          borderRadius: 4,
        }}
      >
        {/* 头部 */}
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid #e0e0e0",
            fontWeight: 600,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>图层</span>
          <span style={{ fontSize: 11, color: "#666" }}>{Object.keys(elements).length} 个元素</span>
        </div>

        {/* 图层列表 */}
        <div>
          {flatList.map((item) => (
            <LayerItemRenderer
              key={item.element.id}
              item={item}
              isSelected={selectedElementId === item.element.id}
              isHovered={hoveredElementId === item.element.id}
              isDragging={dragState.draggedId === item.element.id}
              isDropTarget={dragState.dropTargetId === item.element.id}
              dropPosition={dragState.dropTargetId === item.element.id ? dragState.dropPosition : null}
              onSelect={() => onElementSelect?.(item.element.id)}
              onHover={(isHovered) => onElementHover?.(isHovered ? item.element.id : null)}
              onToggleExpand={() => handleToggleExpand(item.element.id)}
              onToggleVisibility={() => handleToggleVisibility(item.element.id)}
              onToggleLock={() => handleToggleLock(item.element.id)}
              onDragStart={handleDragStart(item.element.id)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver(item.element.id)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(item.element.id)}
            />
          ))}
        </div>
      </div>
    );
  },
);

LayerPanel.displayName = "LayerPanel";
