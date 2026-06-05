/**
 * CanvasKit Node.js 环境验证
 *
 * 用于在 Node.js 环境中验证 CanvasKit 基础功能
 */

import CanvasKitInit from "canvaskit-wasm/full";

interface VerifyResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * 验证 CanvasKit 在 Node.js 环境中的加载
 */
async function verifyNodeLoad(): Promise<VerifyResult> {
  const startTime = performance.now();

  try {
    const CanvasKit = await CanvasKitInit();
    const loadTime = performance.now() - startTime;

    return {
      success: true,
      message: `CanvasKit 在 Node.js 中加载成功 (${loadTime.toFixed(2)}ms)`,
      data: {
        version: "0.40.0",
        loadTime,
        environment: "Node.js",
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `CanvasKit 加载失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 验证 Surface 创建（离屏渲染）
 */
async function verifyOffscreenSurface(): Promise<VerifyResult> {
  const startTime = performance.now();

  try {
    const CanvasKit = await CanvasKitInit();

    // 创建离屏 Surface
    const surface = CanvasKit.MakeSurface(800, 600);
    if (!surface) {
      throw new Error("无法创建离屏 Surface");
    }

    const createTime = performance.now() - startTime;

    // 清理
    surface.delete();

    return {
      success: true,
      message: `离屏 Surface 创建成功 (${createTime.toFixed(2)}ms)`,
      data: {
        createTime,
        width: 800,
        height: 600,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Surface 创建失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 验证基本渲染和导出
 */
async function verifyRenderAndExport(): Promise<VerifyResult> {
  const startTime = performance.now();

  try {
    const CanvasKit = await CanvasKitInit();

    const surface = CanvasKit.MakeSurface(800, 600);
    if (!surface) {
      throw new Error("无法创建 Surface");
    }

    const canvas = surface.getCanvas();

    // 渲染背景
    canvas.clear(CanvasKit.WHITE);

    // 渲染矩形
    const paint = new CanvasKit.Paint();
    paint.setColor(CanvasKit.Color(76, 175, 80, 1.0));
    paint.setStyle(CanvasKit.PaintStyle.Fill);

    const rect = CanvasKit.LTRBRect(50, 50, 250, 150);
    canvas.drawRect(rect, paint);

    // 导出为 PNG
    const image = surface.makeImageSnapshot();
    const pngData = image.encodeToBytes(CanvasKit.ImageFormat.PNG, 100);

    const renderTime = performance.now() - startTime;

    // 清理
    paint.delete();
    image.delete();
    surface.delete();

    return {
      success: true,
      message: `渲染和导出成功 (${renderTime.toFixed(2)}ms)`,
      data: {
        renderTime,
        pngSize: pngData?.length || 0,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `渲染失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 运行 Node.js 环境验证
 */
async function runNodeVerifications(): Promise<void> {
  console.log("🔍 开始 CanvasKit Node.js 环境验证...\n");

  const results: VerifyResult[] = [];

  // 1. 加载测试
  console.log("1. 加载 CanvasKit...");
  const loadResult = await verifyNodeLoad();
  results.push(loadResult);
  console.log(loadResult.success ? "✅" : "❌", loadResult.message);
  if (loadResult.data) {
    console.log("   ", JSON.stringify(loadResult.data, null, 2));
  }
  console.log();

  if (!loadResult.success) {
    console.log("❌ CanvasKit 加载失败，停止后续验证");
    return;
  }

  // 2. Surface 创建
  console.log("2. 创建离屏 Surface...");
  const surfaceResult = await verifyOffscreenSurface();
  results.push(surfaceResult);
  console.log(surfaceResult.success ? "✅" : "❌", surfaceResult.message);
  if (surfaceResult.data) {
    console.log("   ", JSON.stringify(surfaceResult.data, null, 2));
  }
  console.log();

  // 3. 渲染和导出
  console.log("3. 测试渲染和导出...");
  const renderResult = await verifyRenderAndExport();
  results.push(renderResult);
  console.log(renderResult.success ? "✅" : "❌", renderResult.message);
  if (renderResult.data) {
    console.log("   ", JSON.stringify(renderResult.data, null, 2));
  }
  console.log();

  const allPassed = results.every((r) => r.success);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(allPassed ? "✅ 所有验证通过" : "❌ 部分验证失败");
  console.log(`通过: ${results.filter((r) => r.success).length}/${results.length}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

// 运行验证
runNodeVerifications().catch(console.error);
