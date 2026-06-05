import { CanvasKitLoader } from "./CanvasKitLoader";
import { FontManager } from "./FontManager";
import { resetSurfaceManager } from "./SurfaceManager";

/**
 * 重置浏览器端 CanvasKit runtime。
 *
 * CanvasKit/WASM 一旦触发 Emscripten abort，现有 module / surface / font provider
 * 可能全部进入不可恢复状态。这里显式清理单例，允许下一次初始化走全新 runtime。
 */
export function resetCanvasKitRuntime(): void {
  resetSurfaceManager();
  FontManager.getInstance().reset();
  CanvasKitLoader.getInstance().reset();
}
