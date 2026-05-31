import { useEffect, useState } from "react";
import { Viewer, buildViewerModel } from "@xenonbyte/forma-viewer";
import type { ViewerEntry } from "@xenonbyte/forma-viewer";
import type { FormaApiClient } from "../api.js";
import { mapArtifactsToViewerInputs } from "../viewer/mapArtifacts.js";
import { createWebResourceResolver } from "../viewer/resolver.js";

export interface ViewerPageProps {
  client: FormaApiClient;
  params: { productId: string; reqId: string; pageId?: string };
  entry: ViewerEntry;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; model: ReturnType<typeof buildViewerModel> };

export function ViewerPage({ client, params, entry }: ViewerPageProps): React.ReactElement {
  const { productId, reqId, pageId } = params;
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      try {
        const [product, requirement, artifactList] = await Promise.all([
          client.getProduct(productId),
          client.getRequirement(productId, reqId),
          client.listProductArtifacts(productId)
        ]);
        const reqArtifacts = artifactList.artifacts.filter((a) => a.requirement_id === reqId);
        const scoped = entry === "page" ? reqArtifacts.filter((a) => a.page_id === pageId) : reqArtifacts;
        const inputs = mapArtifactsToViewerInputs({
          artifacts: scoped,
          pages: requirement.pages.map((p) => ({ page_id: p.page_id, name: p.name })),
          platform: product.platform
        });
        const model = buildViewerModel({ entry, artifacts: inputs });
        if (!cancelled) setState({ status: "ready", model });
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "加载失败" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, productId, reqId, pageId, entry]);

  if (state.status === "loading") return <div role="status">加载中…</div>;
  if (state.status === "error") return <div role="alert">加载失败:{state.message}</div>;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Viewer model={state.model} resolver={createWebResourceResolver(productId)} />
    </div>
  );
}
