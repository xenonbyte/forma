/**
 * WebGL 渲染器（可选）
 *
 * 任务 5.36: 用于超大文件的 WebGL 渲染器基础框架
 *
 * 注意：这是一个可选的高级功能，用于处理数万元素的超大文件。
 * 对于常规使用场景，Konva Canvas 渲染器已经足够。
 */

import { memo, useEffect, useRef, useCallback, useState } from "react";
import type { IRElement } from "@vzi-core/types";
import { buildWebGLRenderBatch, parseWebGLColor } from "./webgl-render-utils";

/**
 * WebGL 渲染器配置
 */
export interface WebGLRendererConfig {
  /** 是否启用 WebGL（如果不可用则回退到 Canvas 2D） */
  enabled?: boolean;
  /** 最大纹理尺寸 */
  maxTextureSize?: number;
  /** 是否使用抗锯齿 */
  antialias?: boolean;
  /** 背景色 */
  backgroundColor?: string;
}

/**
 * WebGL 渲染器属性
 */
export interface WebGLRendererProps {
  /** 元素列表 */
  elements: IRElement[];
  /** 容器宽度 */
  width: number;
  /** 容器高度 */
  height: number;
  /** 视口信息 */
  viewport: {
    x: number;
    y: number;
    scale: number;
  };
  /** 配置 */
  config?: WebGLRendererConfig;
  /** 渲染完成回调 */
  onRenderComplete?: (stats: RenderStats) => void;
  /** WebGL 不可用时的回调 */
  onWebGLUnavailable?: () => void;
}

/**
 * 渲染统计信息
 */
export interface RenderStats {
  /** 渲染的元素数量 */
  elementCount: number;
  /** 帧时间（毫秒） */
  frameTime: number;
  /** 是否使用 WebGL */
  usedWebGL: boolean;
  /** GPU 内存使用（估算） */
  gpuMemoryEstimate?: number;
}

/**
 * WebGL 上下文信息
 */
interface WebGLContextInfo {
  gl: WebGLRenderingContext | WebGL2RenderingContext | null;
  isWebGL2: boolean;
  maxTextureSize: number;
}

/**
 * 检查 WebGL 是否可用
 */
function checkWebGLAvailability(): WebGLContextInfo {
  const canvas = document.createElement("canvas");

  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let isWebGL2 = false;

  // 尝试 WebGL 2
  gl = canvas.getContext("webgl2");
  if (gl) {
    isWebGL2 = true;
  } else {
    // 回退到 WebGL 1
    const webgl1 = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    gl = webgl1 as WebGLRenderingContext | null;
  }

  const maxTextureSize = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;

  return { gl, isWebGL2, maxTextureSize };
}

/**
 * 简单的着色器编译
 */
function createShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compilation error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

/**
 * 创建 WebGL 程序
 */
function createProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program linking error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

// 基础顶点着色器
const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  attribute vec4 a_color;

  uniform vec2 u_resolution;
  uniform vec2 u_translation;
  uniform float u_scale;

  varying vec4 v_color;

  void main() {
    vec2 position = (a_position * u_scale + u_translation) / u_resolution * 2.0 - 1.0;
    gl_Position = vec4(position * vec2(1, -1), 0, 1);
    v_color = a_color;
  }
`;

// 基础片段着色器
const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;
  varying vec4 v_color;

  void main() {
    gl_FragColor = v_color;
  }
`;

/**
 * WebGL 渲染器组件
 */
export const WebGLRenderer: React.FC<WebGLRendererProps> = memo(
  ({ elements, width, height, viewport, config = {}, onRenderComplete, onWebGLUnavailable }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const glRef = useRef<WebGLRenderingContext | null>(null);
    const programRef = useRef<WebGLProgram | null>(null);
    const [isWebGLAvailable, setIsWebGLAvailable] = useState(true);

    const { enabled = true, backgroundColor = "#ffffff" } = config;

    // 初始化 WebGL
    useEffect(() => {
      if (!enabled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const info = checkWebGLAvailability();

      if (!info.gl) {
        setIsWebGLAvailable(false);
        onWebGLUnavailable?.();
        return;
      }

      glRef.current = info.gl;
      const gl = info.gl;

      // 设置视口
      gl.viewport(0, 0, width, height);

      // 编译着色器
      const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
      const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);

      if (vertexShader && fragmentShader) {
        programRef.current = createProgram(gl, vertexShader, fragmentShader);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
      }

      if (!programRef.current) {
        setIsWebGLAvailable(false);
        onWebGLUnavailable?.();
        return;
      }

      // 清理
      return () => {
        if (programRef.current) {
          gl.deleteProgram(programRef.current);
        }
      };
    }, [enabled, width, height, onWebGLUnavailable]);

    // 渲染循环
    const render = useCallback(() => {
      const gl = glRef.current;
      const program = programRef.current;
      const canvas = canvasRef.current;

      if (!gl || !program || !canvas) return;

      const startTime = performance.now();
      const { vertexData, drawnElementCount } = buildWebGLRenderBatch(elements);

      // 清除画布
      const clearColor = parseWebGLColor(backgroundColor, 1, [1, 1, 1, 1]) ?? [1, 1, 1, 1];
      gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // 使用程序
      gl.useProgram(program);

      // 设置 uniform
      const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
      const translationLocation = gl.getUniformLocation(program, "u_translation");
      const scaleLocation = gl.getUniformLocation(program, "u_scale");

      gl.uniform2f(resolutionLocation, width, height);
      gl.uniform2f(translationLocation, viewport.x, viewport.y);
      gl.uniform1f(scaleLocation, viewport.scale);

      if (vertexData.length > 0) {
        const vertexBuffer = gl.createBuffer();
        const positionLocation = gl.getAttribLocation(program, "a_position");
        const colorLocation = gl.getAttribLocation(program, "a_color");

        if (vertexBuffer && positionLocation >= 0 && colorLocation >= 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

          const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
          gl.enableVertexAttribArray(positionLocation);
          gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
          gl.enableVertexAttribArray(colorLocation);
          gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

          gl.drawArrays(gl.TRIANGLES, 0, vertexData.length / 6);
          gl.deleteBuffer(vertexBuffer);
        }
      }

      const frameTime = performance.now() - startTime;

      onRenderComplete?.({
        elementCount: drawnElementCount,
        frameTime,
        usedWebGL: true,
        gpuMemoryEstimate: vertexData.byteLength,
      });
    }, [elements, width, height, viewport, backgroundColor, onRenderComplete]);

    // 响应视口变化
    useEffect(() => {
      render();
    }, [render]);

    // 如果 WebGL 不可用或禁用，显示回退提示
    if (!isWebGLAvailable || !enabled) {
      return (
        <div
          style={{
            width,
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor,
            color: "#666666",
            fontSize: 14,
          }}
        >
          {!enabled ? "WebGL 渲染器已禁用" : "WebGL 不可用，请使用 Canvas 渲染器"}
        </div>
      );
    }

    return (
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width,
          height,
          display: "block",
        }}
      />
    );
  },
);

WebGLRenderer.displayName = "WebGLRenderer";

/**
 * 检查是否应该使用 WebGL
 *
 * 根据元素数量和设备能力决定是否启用 WebGL
 */
export function shouldUseWebGL(elementCount: number, threshold: number = 5000): boolean {
  // 元素数量超过阈值时考虑使用 WebGL
  if (elementCount < threshold) {
    return false;
  }

  // 检查 WebGL 是否可用
  const info = checkWebGLAvailability();
  return info.gl !== null;
}

/**
 * 获取 WebGL 能力信息
 */
export function getWebGLCapabilities(): {
  available: boolean;
  webgl2: boolean;
  maxTextureSize: number;
  vendor: string;
  renderer: string;
} {
  const info = checkWebGLAvailability();

  if (!info.gl) {
    return {
      available: false,
      webgl2: false,
      maxTextureSize: 0,
      vendor: "",
      renderer: "",
    };
  }

  const gl = info.gl;
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");

  return {
    available: true,
    webgl2: info.isWebGL2,
    maxTextureSize: info.maxTextureSize,
    vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : "unknown",
    renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "unknown",
  };
}
