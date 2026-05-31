import { useState, useEffect } from 'react';

interface StyleDetailProps {
  name: string;
}

interface BrandStyleContent {
  kind: 'brand';
  metadata: { name: string; description: string };
  designMd: string;
  tokensCss: string;
  componentsHtml: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; content: BrandStyleContent };

/**
 * Desktop brand-style detail (read-only). Reads the 3-file brand content
 * (DESIGN.md / tokens.css / components.html) ONLY through the preload IPC
 * `window.forma.getStyle(name)` — never via `fetch`. System styles are a
 * catalog stub elsewhere and never routed here.
 */
export function StyleDetail({ name }: StyleDetailProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    const getStyle = window.forma?.getStyle;
    if (!getStyle) {
      setState({ status: 'error' });
      return;
    }
    getStyle(name)
      .then((content) => {
        if (!cancelled) setState({ status: 'ready', content });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (state.status === 'loading') {
    return <div className="workspace__status">加载中…</div>;
  }

  if (state.status === 'error') {
    return <div className="workspace__status">加载失败:无法读取品牌风格「{name}」</div>;
  }

  const { content } = state;

  return (
    <div className="style-detail">
      <h2 className="style-detail__title">{content.metadata.name}</h2>

      <section>
        <h3 className="style-detail__section-title">DESIGN.md</h3>
        <pre className="style-detail__pre">{content.designMd || '(空)'}</pre>
      </section>

      <section>
        <h3 className="style-detail__section-title">tokens.css</h3>
        <pre className="style-detail__pre">{content.tokensCss}</pre>
      </section>

      <section>
        <h3 className="style-detail__section-title">components.html</h3>
        <iframe
          className="style-detail__iframe"
          sandbox="allow-same-origin"
          srcDoc={content.componentsHtml}
          title="components"
        />
      </section>
    </div>
  );
}
