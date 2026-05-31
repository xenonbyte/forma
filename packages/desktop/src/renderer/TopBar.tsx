interface TopBarProps {
  productName: string;
  /** Breadcrumb of the current selection, e.g. "登录需求 / 登录页". May be empty. */
  crumb: string;
}

/** Presentational top bar: breadcrumb on the left, active product name on the right. */
export function TopBar({ productName, crumb }: TopBarProps) {
  return (
    <header className="topbar">
      <span className="topbar__crumb">{crumb}</span>
      <span className="topbar__product">{productName}</span>
    </header>
  );
}
