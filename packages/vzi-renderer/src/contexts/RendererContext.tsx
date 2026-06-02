/**
 * 渲染器状态管理 Context
 *
 * 使用 React Context 管理渲染器的全局状态
 */

import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import type { IRElement } from '@vzi-core/types';
import type {
  RendererState,
  RendererAction,
  ViewportState,
  VZIRendererProps,
} from '../types';
import { calculateViewportBounds } from '../utils/spatial-utils';

// ============================================
// 初始状态
// ============================================

/**
 * 创建初始状态
 */
function createInitialState(props: VZIRendererProps): RendererState {
  const {
    width,
    height,
    initialScale = 1,
    showGrid = false,
    showRulers = false,
    showAnnotations = false,
    selectedElementId = null,
    hoveredElementId = null,
  } = props;

  return {
    viewport: {
      scale: initialScale,
      x: 0,
      y: 0,
      width,
      height,
      canvasWidth: 1200,
      canvasHeight: 800,
    },
    selectedElementId,
    hoveredElementId,
    isDragging: false,
    isSelecting: false,
    selectionRect: null,
    showGrid,
    showRulers,
    showAnnotations,
  };
}

// ============================================
// Reducer
// ============================================

/**
 * 渲染器状态 Reducer
 */
function rendererReducer(state: RendererState, action: RendererAction): RendererState {
  switch (action.type) {
    case 'SET_SCALE':
      return {
        ...state,
        viewport: {
          ...state.viewport,
          scale: action.scale,
        },
      };

    case 'SET_POSITION':
      return {
        ...state,
        viewport: {
          ...state.viewport,
          x: action.x,
          y: action.y,
        },
      };

    case 'ZOOM_TO': {
      const { scale, centerX, centerY } = action;
      const { viewport } = state;

      // 计算新的位置，保持缩放中心不变
      const scaleRatio = scale / viewport.scale;
      const newX = centerX - (centerX - viewport.x) * scaleRatio;
      const newY = centerY - (centerY - viewport.y) * scaleRatio;

      return {
        ...state,
        viewport: {
          ...viewport,
          scale,
          x: newX,
          y: newY,
        },
      };
    }

    case 'SELECT_ELEMENT':
      return {
        ...state,
        selectedElementId: action.elementId,
      };

    case 'HOVER_ELEMENT':
      return {
        ...state,
        hoveredElementId: action.elementId,
      };

    case 'START_DRAG':
      return {
        ...state,
        isDragging: true,
      };

    case 'END_DRAG':
      return {
        ...state,
        isDragging: false,
      };

    case 'START_SELECTION':
      return {
        ...state,
        isSelecting: true,
        selectionRect: action.rect,
      };

    case 'UPDATE_SELECTION':
      return {
        ...state,
        selectionRect: action.rect,
      };

    case 'END_SELECTION':
      return {
        ...state,
        isSelecting: false,
        selectionRect: null,
      };

    case 'TOGGLE_GRID':
      return {
        ...state,
        showGrid: !state.showGrid,
      };

    case 'TOGGLE_RULERS':
      return {
        ...state,
        showRulers: !state.showRulers,
      };

    case 'TOGGLE_ANNOTATIONS':
      return {
        ...state,
        showAnnotations: !state.showAnnotations,
      };

    default:
      return state;
  }
}

// ============================================
// Context 类型
// ============================================

interface RendererContextValue {
  /** 状态 */
  state: RendererState;
  /** 派发动作 */
  dispatch: React.Dispatch<RendererAction>;
  /** 元素映射 */
  elements: Record<string, IRElement>;
  /** 根元素 ID */
  rootElementId: string;
  /** 视口边界 */
  viewportBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  /** 选中元素 */
  selectedElement: IRElement | null;
  /** 悬停元素 */
  hoveredElement: IRElement | null;
  /** 选择元素 */
  selectElement: (elementId: string | null) => void;
  /** 悬停元素 */
  hoverElement: (elementId: string | null) => void;
  /** 设置缩放 */
  setScale: (scale: number) => void;
  /** 缩放到指定点 */
  zoomTo: (scale: number, centerX: number, centerY: number) => void;
  /** 设置位置 */
  setPosition: (x: number, y: number) => void;
  /** 切换网格 */
  toggleGrid: () => void;
  /** 切换标尺 */
  toggleRulers: () => void;
  /** 切换标注 */
  toggleAnnotations: () => void;
}

const RendererContext = createContext<RendererContextValue | null>(null);

// ============================================
// Provider
// ============================================

interface RendererProviderProps {
  children: React.ReactNode;
  /** 渲染器属性 */
  props: VZIRendererProps;
  /** 元素映射 */
  elements: Record<string, IRElement>;
  /** 根元素 ID */
  rootElementId: string;
  /** 画布尺寸 */
  canvasSize: { width: number; height: number };
}

/**
 * 渲染器状态 Provider
 */
export const RendererProvider: React.FC<RendererProviderProps> = ({
  children,
  props,
  elements,
  rootElementId,
  canvasSize,
}) => {
  const [state, dispatch] = useReducer(rendererReducer, createInitialState(props));

  // 更新画布尺寸
  const viewportWithCanvas = useMemo(() => ({
    ...state.viewport,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
  }), [state.viewport, canvasSize]);

  // 计算视口边界
  const viewportBounds = useMemo(() => {
    return calculateViewportBounds(
      state.viewport.x,
      state.viewport.y,
      state.viewport.width,
      state.viewport.height,
      state.viewport.scale,
      100 // 预渲染边距
    );
  }, [state.viewport]);

  // 获取选中元素
  const selectedElement = useMemo(() => {
    return state.selectedElementId ? elements[state.selectedElementId] || null : null;
  }, [elements, state.selectedElementId]);

  // 获取悬停元素
  const hoveredElement = useMemo(() => {
    return state.hoveredElementId ? elements[state.hoveredElementId] || null : null;
  }, [elements, state.hoveredElementId]);

  // 选择元素
  const selectElement = useCallback((elementId: string | null) => {
    dispatch({ type: 'SELECT_ELEMENT', elementId });
    props.onElementSelect?.(elementId);
  }, [props]);

  // 悬停元素
  const hoverElement = useCallback((elementId: string | null) => {
    dispatch({ type: 'HOVER_ELEMENT', elementId });
    props.onElementHover?.(elementId);
  }, [props]);

  // 设置缩放
  const setScale = useCallback((scale: number) => {
    dispatch({ type: 'SET_SCALE', scale });
    props.onScaleChange?.(scale);
  }, [props]);

  // 缩放到指定点
  const zoomTo = useCallback((scale: number, centerX: number, centerY: number) => {
    dispatch({ type: 'ZOOM_TO', scale, centerX, centerY });
    props.onScaleChange?.(scale);
  }, [props]);

  // 设置位置
  const setPosition = useCallback((x: number, y: number) => {
    dispatch({ type: 'SET_POSITION', x, y });
    props.onPositionChange?.(x, y);
  }, [props]);

  // 切换网格
  const toggleGrid = useCallback(() => {
    dispatch({ type: 'TOGGLE_GRID' });
  }, []);

  // 切换标尺
  const toggleRulers = useCallback(() => {
    dispatch({ type: 'TOGGLE_RULERS' });
  }, []);

  // 切换标注
  const toggleAnnotations = useCallback(() => {
    dispatch({ type: 'TOGGLE_ANNOTATIONS' });
  }, []);

  const value = useMemo<RendererContextValue>(() => ({
    state: {
      ...state,
      viewport: viewportWithCanvas,
    },
    dispatch,
    elements,
    rootElementId,
    viewportBounds,
    selectedElement,
    hoveredElement,
    selectElement,
    hoverElement,
    setScale,
    zoomTo,
    setPosition,
    toggleGrid,
    toggleRulers,
    toggleAnnotations,
  }), [
    state,
    viewportWithCanvas,
    elements,
    rootElementId,
    viewportBounds,
    selectedElement,
    hoveredElement,
    selectElement,
    hoverElement,
    setScale,
    zoomTo,
    setPosition,
    toggleGrid,
    toggleRulers,
    toggleAnnotations,
  ]);

  return (
    <RendererContext.Provider value={value}>
      {children}
    </RendererContext.Provider>
  );
};

// ============================================
// Hook
// ============================================

/**
 * 使用渲染器上下文
 */
export function useRenderer(): RendererContextValue {
  const context = useContext(RendererContext);

  if (!context) {
    throw new Error('useRenderer must be used within a RendererProvider');
  }

  return context;
}

/**
 * 使用视口状态
 */
export function useViewport(): ViewportState {
  const { state } = useRenderer();
  return state.viewport;
}

/**
 * 使用选中元素
 */
export function useSelectedElement(): IRElement | null {
  const { selectedElement } = useRenderer();
  return selectedElement;
}

/**
 * 使用悬停元素
 */
export function useHoveredElement(): IRElement | null {
  const { hoveredElement } = useRenderer();
  return hoveredElement;
}

/**
 * Renderer Provider 组件（直接导出）
 */
export { RendererContext };
