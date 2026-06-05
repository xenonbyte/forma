import type { ResourceRef, ResourceResolver } from "@xenonbyte/forma-viewer";

/**
 * web 同源 HTTP 资源解析器,产品作用域。URL 路径与 server 版本化路由一致:
 * bundle → /versions/:v/bundle/index.html;asset → /versions/:v/bundle/:path;
 * preview → /versions/:v/preview/:density.png(server 要求 .png 后缀)。
 */
export function createWebResourceResolver(productId: string): ResourceResolver {
  const pid = encodeURIComponent(productId);
  return {
    resolve(ref: ResourceRef): string {
      const aid = encodeURIComponent(ref.artifactId);
      const base = `/api/products/${pid}/artifacts/${aid}/versions/${ref.version}`;
      if (ref.kind === "preview") {
        return `${base}/preview/${ref.density ?? "1x"}.png`;
      }
      if (ref.kind === "asset") {
        return `${base}/bundle/${ref.path ?? ""}`;
      }
      return `${base}/bundle/index.html`;
    },
  };
}
