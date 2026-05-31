# @xenonbyte/forma-viewer

Forma 共享只读查看器:无限画布外壳(左 设计稿列表 / 中 画布 / 右 标注 slot),
设计画布渲染静态 HTML(`<iframe sandbox>` 禁脚本),标注画布渲染 PNG。
纯展示、数据驱动;web(HTTP)/desktop(IPC) 经同一 view-model 契约 + 注入式
资源解析器同源消费。

## 消费模型
- 通过 `exports` 暴露 `./src/index.ts`,消费方(web/desktop,均 Vite)直接打包源码。
- 无独立 build emit;类型检查走 `pnpm --filter @xenonbyte/forma-viewer typecheck`。

## 契约(view-model)

viewer 是纯展示组件,消费方负责把自身数据源映射成 `ViewerModel` 并注入 `ResourceResolver`。

### 顶层用法
```tsx
import { Viewer, buildViewerModel } from "@xenonbyte/forma-viewer";
import type { ResourceResolver, NormalizeArtifactInput } from "@xenonbyte/forma-viewer";

const artifacts: NormalizeArtifactInput[] = /* 由 web(HTTP) 或 desktop(IPC) 数据映射 */;
const model = buildViewerModel({ entry: "requirement", artifacts });
const resolver: ResourceResolver = {
  resolve: (ref) => /* web: HTTP URL;desktop: app:// 或 IPC URL */
};

<Viewer model={model} resolver={resolver} />;
```

### 关键类型
- `NormalizeArtifactInput`:中性单 artifact(artifactId/kind/pageId/pageName/variant/title/version/width/height)。
- `ViewerModel`:`{ entry, tiles: PositionedTile[], groups: ViewerGroup[] }`。
- `ResourceRef`:不透明引用 `{ artifactId, version, kind: "bundle"|"preview"|"asset", density?, path? }`。
- `PreviewImageRefs`:`{ "1x": ResourceRef, "2x": ResourceRef }`;标注 PNG 必须保留 1x/2x 两档。
- `ResourceResolver.resolve(ref) => string`:消费方实现(web HTTP / desktop IPC)。

### 消费方如何从 Forma 后端映射(P8/P9 接入指引)
后端 `get_product_artifact(product_id, artifact_id)` 已返回/必须在 P4 暴露(执行期按实际工具字段核对):
`{ manifest, bundle_url, assets: [{ path, role, density, degraded?, urls: { "1x"|"2x"|"3x": url } }], preview_urls: { "1x": url, "2x": url }, versions: number[], current_version }`;
`list_product_artifacts` 每条含 `{ id, kind, title, requirement_id, page_id, variant, versions, current_version, preview_urls, superseded }`。
- `NormalizeArtifactInput.{artifactId,kind,pageId,variant,version}` ← 上述 `id/kind/page_id/variant/current_version`。
- `ResourceResolver.resolve`:`kind:"bundle"` → 后端 `bundle_url`;`kind:"preview", density:"1x"|"2x"` → `preview_urls[density]`;`kind:"asset"` → `assets[].urls[density]`(按 `path` 匹配)。web 直接用这些相对 URL;desktop 经只读 preload bridge 暴露为可取 URL。
- `width/height` 不在后端返回中 → 消费方按平台/约定提供(或后续在 manifest 增字段);P8/P9 决定来源,本期 viewer 只消费。

### 不变量
- 设计画布 tile = `<iframe sandbox>`(无 `allow-scripts`);标注画布 tile = `<img>` PNG,`src` 指向 1x、`srcSet` 指向 2x。
- 画布区域虚拟化:`onlyRenderVisibleElements`,离屏 tile 卸载。
- 右侧标注 slot 本期仅占位。
- 契约变更必须同步 web/desktop 两端 + 测试(唯一耦合点)。
