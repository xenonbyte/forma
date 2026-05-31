import type { WorkspaceSelection } from './WorkspacePane.js';

interface SidebarProduct {
  id: string;
  name: string;
  description: string;
}

interface SidebarRequirement {
  id: string;
  title: string;
  status: string;
  ui_affected: boolean;
}

interface SidebarPage {
  page_id: string;
  name: string;
}

interface SidebarBrandStyle {
  name: string;
  description: string;
}

interface SidebarProps {
  products: SidebarProduct[];
  activeProductId: string | null;
  requirements: SidebarRequirement[];
  /** Pages of the currently-selected requirement (from getRequirement(...).pages). */
  pages: SidebarPage[];
  /** Brand styles only — system styles are a catalog stub and never listed here. */
  brandStyles: SidebarBrandStyle[];
  connected: boolean;
  nav: WorkspaceSelection;
  onSelect: (selection: WorkspaceSelection) => void;
  onSelectProduct: (productId: string) => void;
}

function itemClass(active: boolean): string {
  return active ? 'sidebar__item sidebar__item--active' : 'sidebar__item';
}

/**
 * Presentational sidebar (props in, callbacks out). Renders the product
 * switcher, the 需求 / 页面 / 品牌风格 nav sections, and the bottom connection
 * status dot. The active requirement id (when nav is a requirement/page) is
 * carried into page selections.
 */
export function Sidebar({
  products,
  activeProductId,
  requirements,
  pages,
  brandStyles,
  connected,
  nav,
  onSelect,
  onSelectProduct,
}: SidebarProps) {
  const activeReqId = nav.type === 'requirement' || nav.type === 'page' ? nav.reqId : null;

  return (
    <nav className="sidebar">
      <div className="sidebar__switcher">
        <span className="sidebar__switcher-label">产品</span>
        <select
          className="sidebar__select"
          data-product-switcher
          value={activeProductId ?? ''}
          onChange={(e) => onSelectProduct(e.target.value)}
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <section className="sidebar__section">
        <h2 className="sidebar__section-title">需求</h2>
        {requirements.length === 0 ? (
          <span className="sidebar__empty">暂无需求</span>
        ) : (
          requirements.map((r) => (
            <button
              key={r.id}
              type="button"
              className={itemClass(activeReqId === r.id && nav.type === 'requirement')}
              data-nav-requirement={r.id}
              onClick={() => onSelect({ type: 'requirement', reqId: r.id })}
            >
              {r.title}
            </button>
          ))
        )}
      </section>

      <section className="sidebar__section">
        <h2 className="sidebar__section-title">页面</h2>
        {pages.length === 0 ? (
          <span className="sidebar__empty">选择需求以查看页面</span>
        ) : (
          pages.map((pg) => (
            <button
              key={pg.page_id}
              type="button"
              className={itemClass(nav.type === 'page' && nav.pageId === pg.page_id)}
              data-nav-page={pg.page_id}
              disabled={!activeReqId}
              onClick={() => {
                if (activeReqId) onSelect({ type: 'page', reqId: activeReqId, pageId: pg.page_id });
              }}
            >
              {pg.name}
            </button>
          ))
        )}
      </section>

      <section className="sidebar__section">
        <h2 className="sidebar__section-title">品牌风格</h2>
        {brandStyles.length === 0 ? (
          <span className="sidebar__empty">暂无品牌风格</span>
        ) : (
          brandStyles.map((s) => (
            <button
              key={s.name}
              type="button"
              className={itemClass(nav.type === 'style' && nav.name === s.name)}
              data-nav-style={s.name}
              onClick={() => onSelect({ type: 'style', name: s.name })}
            >
              {s.name}
            </button>
          ))
        )}
      </section>

      <div className="sidebar__status">
        <span className={`sidebar__dot ${connected ? 'sidebar__dot--on' : 'sidebar__dot--off'}`} />
        {connected ? '已连接' : '未连接'}
      </div>
    </nav>
  );
}
