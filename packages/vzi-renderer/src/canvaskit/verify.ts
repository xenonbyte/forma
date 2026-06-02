/**
 * CanvasKit 技术验证
 *
 * 验证 CanvasKit 基础功能：
 * 1. WASM 模块加载
 * 2. Surface 创建（WebGL 和 CPU）
 * 3. 基本图形渲染
 * 4. 性能测试
 */

// CanvasKit 动态导入，不需要静态导入类型
// 在函数中使用动态 import 以避免 Node.js 环境加载问题

interface VerifyResult {
  success: boolean;
  message: string;
  data?: unknown;
}

interface PerformanceMetrics {
  loadTime: number;
  surfaceCreateTime: number;
  renderTime: number;
  totalTime: number;
}

/**
 * 验证 CanvasKit 加载
 */
export async function verifyCanvasKitLoad(): Promise<VerifyResult> {
  const startTime = performance.now();

  try {
    // 动态导入 CanvasKit
    const CanvasKitModule = await import('canvaskit-wasm');

    // 加载 WASM 模块（使用 any 类型断言以绕过复杂类型定义）
    const CanvasKit = await (CanvasKitModule.default as any)({
      locateFile: (file: string) => {
        // 在生产环境中，应该使用 CDN
        return `https://unpkg.com/canvaskit-wasm@0.40.0/bin/${file}`;
      },
    });

    const loadTime = performance.now() - startTime;

    return {
      success: true,
      message: `CanvasKit 加载成功 (${loadTime.toFixed(2)}ms)`,
      data: {
        version: '0.40.0',
        loadTime,
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
 * 验证 WebGL 支持
 */
export function verifyWebGLSupport(): VerifyResult {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');

    if (!gl) {
      return {
        success: false,
        message: 'WebGL 不支持',
      };
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : 'Unknown';

    return {
      success: true,
      message: 'WebGL 支持',
      data: {
        version: gl instanceof WebGL2RenderingContext ? 'WebGL 2.0' : 'WebGL 1.0',
        renderer,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `WebGL 检测失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 验证 Surface 创建
 */
export async function verifySurfaceCreation(): Promise<VerifyResult> {
  const startTime = performance.now();

  try {
    const CanvasKitModule = await import('canvaskit-wasm');
    const CanvasKit = await (CanvasKitModule.default as any)({
      locateFile: (file: string) => `https://unpkg.com/canvaskit-wasm@0.40.0/bin/${file}`,
    });

    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;

    // 尝试创建 WebGL Surface
    let surface = CanvasKit.MakeWebGLCanvasSurface(canvas);
    let backend = 'WebGL';

    if (!surface) {
      // 降级到 CPU 渲染
      surface = CanvasKit.MakeCanvasSurface(canvas);
      backend = 'CPU';

      if (!surface) {
        throw new Error('无法创建 Surface');
      }
    }

    const createTime = performance.now() - startTime;

    // 清理
    surface.delete();

    return {
      success: true,
      message: `Surface 创建成功 (${backend}, ${createTime.toFixed(2)}ms)`,
      data: {
        backend,
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
 * 验证基本渲染
 */
export async function verifyBasicRendering(): Promise<VerifyResult> {
  const startTime = performance.now();

  try {
    const CanvasKitModule = await import('canvaskit-wasm');
    const CanvasKit = await (CanvasKitModule.default as any)({
      locateFile: (file: string) => `https://unpkg.com/canvaskit-wasm@0.40.0/bin/${file}`,
    });

    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;

    const surface = CanvasKit.MakeWebGLCanvasSurface(canvas) || CanvasKit.MakeCanvasSurface(canvas);
    if (!surface) {
      throw new Error('无法创建 Surface');
    }

    const skCanvas = surface.getCanvas();

    // 渲染背景
    skCanvas.clear(CanvasKit.WHITE);

    // 渲染矩形
    const paint = new CanvasKit.Paint();
    paint.setColor(CanvasKit.Color(76, 175, 80, 1.0)); // #4CAF50
    paint.setStyle(CanvasKit.PaintStyle.Fill);

    const rect = CanvasKit.LTRBRect(50, 50, 250, 150);
    skCanvas.drawRect(rect, paint);

    // 渲染文本
    const textPaint = new CanvasKit.Paint();
    textPaint.setColor(CanvasKit.Color(33, 33, 33, 1.0));
    textPaint.setAntiAlias(true);

    // 使用默认字体
    const typeface = CanvasKit.Typeface.GetDefault();
    const font = new CanvasKit.Font(typeface, 24);
    const textBlob = CanvasKit.TextBlob.MakeFromText('Hello CanvasKit!', font);

    skCanvas.drawTextBlob(textBlob, 50, 200, textPaint);

    // 刷新到屏幕
    surface.flush();

    const renderTime = performance.now() - startTime;

    // 清理
    paint.delete();
    textPaint.delete();
    font.delete();
    textBlob.delete();
    surface.delete();

    return {
      success: true,
      message: `基本渲染成功 (${renderTime.toFixed(2)}ms)`,
      data: {
        renderTime,
        elementsRendered: 2, // 矩形 + 文本
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `基本渲染失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 性能基准测试
 */
export async function runPerformanceBenchmark(): Promise<VerifyResult> {
  try {
    const CanvasKitModule = await import('canvaskit-wasm');

    const loadStart = performance.now();
    const CanvasKit = await (CanvasKitModule.default as any)({
      locateFile: (file: string) => `https://unpkg.com/canvaskit-wasm@0.40.0/bin/${file}`,
    });
    const loadTime = performance.now() - loadStart;

    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;

    const surfaceStart = performance.now();
    const surface = CanvasKit.MakeWebGLCanvasSurface(canvas) || CanvasKit.MakeCanvasSurface(canvas);
    if (!surface) {
      throw new Error('无法创建 Surface');
    }
    const surfaceCreateTime = performance.now() - surfaceStart;

    const skCanvas = surface.getCanvas();

    // 渲染 1000 个矩形
    const renderStart = performance.now();
    skCanvas.clear(CanvasKit.WHITE);

    const paint = new CanvasKit.Paint();
    paint.setStyle(CanvasKit.PaintStyle.Fill);

    for (let i = 0; i < 1000; i++) {
      const x = Math.random() * 1800;
      const y = Math.random() * 1000;
      const width = 50 + Math.random() * 50;
      const height = 50 + Math.random() * 50;

      const r = Math.random();
      const g = Math.random();
      const b = Math.random();
      paint.setColor(CanvasKit.Color(r * 255, g * 255, b * 255, 1.0));

      const rect = CanvasKit.LTRBRect(x, y, x + width, y + height);
      skCanvas.drawRect(rect, paint);
    }

    surface.flush();
    const renderTime = performance.now() - renderStart;

    const totalTime = performance.now() - loadStart;

    // 清理
    paint.delete();
    surface.delete();

    const metrics: PerformanceMetrics = {
      loadTime,
      surfaceCreateTime,
      renderTime,
      totalTime,
    };

    return {
      success: true,
      message: `性能测试完成 (渲染 1000 个元素: ${renderTime.toFixed(2)}ms)`,
      data: metrics,
    };
  } catch (error) {
    return {
      success: false,
      message: `性能测试失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 运行所有验证
 */
export async function runAllVerifications(): Promise<{
  results: VerifyResult[];
  allPassed: boolean;
}> {
  console.log('🔍 开始 CanvasKit 技术验证...\n');

  const results: VerifyResult[] = [];

  // 1. WebGL 支持检测
  console.log('1. 检测 WebGL 支持...');
  const webglResult = verifyWebGLSupport();
  results.push(webglResult);
  console.log(webglResult.success ? '✅' : '❌', webglResult.message);
  if (webglResult.data) {
    console.log('   ', JSON.stringify(webglResult.data, null, 2));
  }
  console.log();

  // 2. CanvasKit 加载
  console.log('2. 加载 CanvasKit WASM...');
  const loadResult = await verifyCanvasKitLoad();
  results.push(loadResult);
  console.log(loadResult.success ? '✅' : '❌', loadResult.message);
  if (loadResult.data) {
    console.log('   ', JSON.stringify(loadResult.data, null, 2));
  }
  console.log();

  if (!loadResult.success) {
    console.log('❌ CanvasKit 加载失败，停止后续验证');
    return { results, allPassed: false };
  }

  // 3. Surface 创建
  console.log('3. 创建 Surface...');
  const surfaceResult = await verifySurfaceCreation();
  results.push(surfaceResult);
  console.log(surfaceResult.success ? '✅' : '❌', surfaceResult.message);
  if (surfaceResult.data) {
    console.log('   ', JSON.stringify(surfaceResult.data, null, 2));
  }
  console.log();

  // 4. 基本渲染
  console.log('4. 测试基本渲染...');
  const renderResult = await verifyBasicRendering();
  results.push(renderResult);
  console.log(renderResult.success ? '✅' : '❌', renderResult.message);
  if (renderResult.data) {
    console.log('   ', JSON.stringify(renderResult.data, null, 2));
  }
  console.log();

  // 5. 性能测试
  console.log('5. 运行性能基准测试...');
  const perfResult = await runPerformanceBenchmark();
  results.push(perfResult);
  console.log(perfResult.success ? '✅' : '❌', perfResult.message);
  if (perfResult.data) {
    console.log('   ', JSON.stringify(perfResult.data, null, 2));
  }
  console.log();

  const allPassed = results.every((r) => r.success);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(allPassed ? '✅ 所有验证通过' : '❌ 部分验证失败');
  console.log(`通过: ${results.filter((r) => r.success).length}/${results.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return { results, allPassed };
}
