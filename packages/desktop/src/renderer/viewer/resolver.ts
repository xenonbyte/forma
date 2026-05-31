import type { ResourceRef, ResourceResolver } from "@xenonbyte/forma-viewer";

/** desktop 资源解析器:URL 路径与 web 一致,base 指向本地 forma server(经 preload formaServerBaseUrl 取得)。 */
export function createDesktopResourceResolver(baseUrl: string, productId: string): ResourceResolver {
  const base = baseUrl.replace(/\/+$/, "");
  const pid = encodeURIComponent(productId);
  return {
    resolve(ref: ResourceRef): string {
      const aid = encodeURIComponent(ref.artifactId);
      const root = `${base}/api/products/${pid}/artifacts/${aid}/versions/${ref.version}`;
      if (ref.kind === "preview") return `${root}/preview/${ref.density ?? "1x"}.png`;
      if (ref.kind === "asset") return `${root}/bundle/${ref.path ?? ""}`;
      return `${root}/bundle/index.html`;
    }
  };
}
