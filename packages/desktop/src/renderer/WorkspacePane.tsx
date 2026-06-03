import { useState, useEffect } from 'react';
import { Viewer, buildViewerModel } from '@xenonbyte/forma-viewer';
import type { ViewerEntry } from '@xenonbyte/forma-viewer';
import { mapArtifactsToViewerInputs, type FormaArtifact } from './viewer/mapArtifacts.js';
import { createDesktopResourceResolver } from './viewer/resolver.js';

/**
 * Workspace selection (productId is supplied separately via prop). `none`
 * renders the empty prompt.
 */
export type WorkspaceSelection =
  | { type: 'none' }
  | { type: 'requirement'; reqId: string }
  | { type: 'page'; reqId: string; pageId: string };

interface WorkspacePaneProps {
  selection: WorkspaceSelection;
  productId: string;
  /** Local forma server base URL — used ONLY for the viewer resource resolver. */
  baseUrl: string;
}

type ViewerState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; model: ReturnType<typeof buildViewerModel> };

export function WorkspacePane({ selection, productId, baseUrl }: WorkspacePaneProps) {
  if (selection.type === 'requirement' || selection.type === 'page') {
    const reqId = selection.reqId;
    const pageId = selection.type === 'page' ? selection.pageId : undefined;
    const entry: ViewerEntry = selection.type === 'page' ? 'page' : 'requirement';
    return (
      <div className="workspace">
        <ViewerSurface productId={productId} reqId={reqId} pageId={pageId} entry={entry} baseUrl={baseUrl} />
      </div>
    );
  }

  return (
    <div className="workspace">
      <div className="workspace__empty">从左侧选择一个需求或页面以开始。</div>
    </div>
  );
}

interface ViewerSurfaceProps {
  productId: string;
  reqId: string;
  pageId: string | undefined;
  entry: ViewerEntry;
  baseUrl: string;
}

function ViewerSurface({ productId, reqId, pageId, entry, baseUrl }: ViewerSurfaceProps) {
  const [state, setState] = useState<ViewerState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    const forma = window.forma;
    if (!forma) {
      setState({ status: 'error', message: '预加载桥接不可用' });
      return;
    }
    void (async () => {
      try {
        const [product, requirement, artifactList] = await Promise.all([
          forma.getProduct(productId),
          forma.getRequirement(productId, reqId),
          forma.listArtifacts(productId),
        ]);
        const reqArtifacts = artifactList.artifacts.filter((a) => a.requirement_id === reqId);
        const scoped = entry === 'page' ? reqArtifacts.filter((a) => a.page_id === pageId) : reqArtifacts;
        const pages = (requirement.pages ?? []).map((p) => ({ page_id: p.page_id, name: p.name }));
        const inputs = mapArtifactsToViewerInputs({
          artifacts: scoped as FormaArtifact[],
          pages,
          platform: product.platform,
        });
        const model = buildViewerModel({ entry, artifacts: inputs });
        if (!cancelled) setState({ status: 'ready', model });
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : '加载失败' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, reqId, pageId, entry]);

  if (state.status === 'loading') return <div className="workspace__status">加载中…</div>;
  if (state.status === 'error') return <div className="workspace__status">加载失败:{state.message}</div>;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Viewer model={state.model} resolver={createDesktopResourceResolver(baseUrl, productId)} />
    </div>
  );
}
