// ---------------------------------------------------------------------------
// Component Baseline — SPEC-DATA-003 / SPEC-BEHAVIOR-009
// Single source of truth for the B2 component baseline list (B7 data).
// Mirrors the raw-requirement B2 list verbatim; do NOT edit without updating
// the corresponding test and the spec references above.
// ---------------------------------------------------------------------------

/**
 * The subset of Platform values that have a defined component baseline.
 * The repo-wide Platform type (from schemas.ts) is the superset; this narrows it to
 * the two supported values for COMPONENT_BASELINES.
 */
export type ComponentPlatform = "web" | "mobile";

/** Foundation category descriptors (B2). Token values come from brand_style at generation time. */
export interface ComponentBaselineFoundations {
  color: string;
  typography: string;
  spacing: string;
  radius: string;
  elevation: string;
  motion: string;
  functionalIconStyle: string;
}

/** Product icon spec — same for all platforms. */
export interface ProductIconSpec {
  variants: ["primary", "monochrome"];
  derivation: "productName+brandStyle";
  shapeStability: "reuse-geometry-recolor";
}

/** A single component entry in the baseline. */
export interface ComponentEntry {
  group: string;
  name: string;
  /** Non-empty subset of: default / hover / focus / disabled / loading / empty / error */
  states: string[];
  variants?: string[];
}

/** Full baseline spec for one platform. */
export interface ComponentBaselineSpec {
  foundations: ComponentBaselineFoundations;
  productIcon: ProductIconSpec;
  components: ComponentEntry[];
}

// ---------------------------------------------------------------------------
// State-coverage helper — every component must pick at least one state.
// The canonical set is: default / hover / focus / disabled / loading / empty / error
// ---------------------------------------------------------------------------

const INTERACTIVE: string[] = ["default", "hover", "focus", "disabled"];
const INTERACTIVE_LOADING: string[] = ["default", "hover", "focus", "disabled", "loading"];
const FORM_INPUT: string[] = ["default", "hover", "focus", "disabled", "error"];
const FEEDBACK: string[] = ["default"];

// ---------------------------------------------------------------------------
// Web — 精选档 · 29 件 · 6 组
// (3 + 6 + 6 + 5 + 6 + 3 = 29)
// ---------------------------------------------------------------------------

const WEB_COMPONENTS: ComponentEntry[] = [
  // ── 动作 (3) ───────────────────────────────────────────────────────────
  {
    group: "动作",
    name: "Button",
    states: INTERACTIVE_LOADING,
    variants: ["primary", "secondary", "ghost", "danger"],
  },
  {
    group: "动作",
    name: "Icon Button",
    states: INTERACTIVE,
  },
  {
    group: "动作",
    name: "Link",
    states: ["default", "hover", "focus", "disabled"],
  },

  // ── 表单 (6) ───────────────────────────────────────────────────────────
  {
    group: "表单",
    name: "Text Input",
    states: FORM_INPUT,
  },
  {
    group: "表单",
    name: "Textarea",
    states: FORM_INPUT,
  },
  {
    group: "表单",
    name: "Select",
    states: FORM_INPUT,
  },
  {
    group: "表单",
    name: "Checkbox",
    states: ["default", "hover", "focus", "disabled"],
  },
  {
    group: "表单",
    name: "Radio",
    states: ["default", "hover", "focus", "disabled"],
  },
  {
    group: "表单",
    name: "Switch",
    states: ["default", "hover", "focus", "disabled"],
  },

  // ── 数据展示 (6) ───────────────────────────────────────────────────────
  {
    group: "数据展示",
    name: "Card",
    states: ["default", "hover"],
  },
  {
    group: "数据展示",
    name: "List/List Item",
    states: ["default", "hover", "empty"],
  },
  {
    group: "数据展示",
    name: "Table",
    states: ["default", "hover", "empty", "loading"],
  },
  {
    group: "数据展示",
    name: "Badge/Tag",
    states: ["default"],
  },
  {
    group: "数据展示",
    name: "Avatar",
    states: ["default"],
  },
  {
    group: "数据展示",
    name: "Tooltip",
    states: ["default"],
  },

  // ── 导航 (5) ───────────────────────────────────────────────────────────
  {
    group: "导航",
    name: "Header/顶栏",
    states: ["default"],
  },
  {
    group: "导航",
    name: "Sidebar/菜单",
    states: ["default"],
  },
  {
    group: "导航",
    name: "Breadcrumb",
    states: ["default"],
  },
  {
    group: "导航",
    name: "Tabs",
    states: ["default", "hover", "focus"],
  },
  {
    group: "导航",
    name: "Pagination",
    states: ["default", "hover", "focus", "disabled"],
  },

  // ── 反馈/浮层 (6) ──────────────────────────────────────────────────────
  {
    group: "反馈/浮层",
    name: "Alert/Banner",
    states: FEEDBACK,
    variants: ["info", "success", "warning", "error"],
  },
  {
    group: "反馈/浮层",
    name: "Toast",
    states: ["default"],
  },
  {
    group: "反馈/浮层",
    name: "Modal/Dialog",
    states: ["default"],
  },
  {
    group: "反馈/浮层",
    name: "Drawer",
    states: ["default"],
  },
  {
    group: "反馈/浮层",
    name: "Progress/Spinner",
    states: ["default", "loading"],
  },
  {
    group: "反馈/浮层",
    name: "Skeleton",
    states: ["default", "loading"],
  },

  // ── 通用三态 (3) ───────────────────────────────────────────────────────
  {
    group: "通用三态",
    name: "Empty",
    states: ["empty"],
  },
  {
    group: "通用三态",
    name: "Loading",
    states: ["loading"],
  },
  {
    group: "通用三态",
    name: "Error",
    states: ["error"],
  },
];

// ---------------------------------------------------------------------------
// Mobile — nav/interaction layer REPLACED; 动作/表单/Card/Badge/Avatar/
// Toast/Alert/Progress/Skeleton/三态 CARRIED OVER.
//
// Data-display carry-over interpretation:
//   Raw text explicitly names: Card / Badge / Avatar (as part of "数据展示"
//   carried items). List/Table/Tooltip are NOT named in the carry-over list,
//   so they are omitted from mobile per verbatim-mirror rule.
//
// Mobile groups: 动作(3) + 表单(6) + 数据展示(3) + 导航/交互(7)
//                + 反馈/浮层(4) + 通用三态(3) = 26
// ---------------------------------------------------------------------------

const MOBILE_COMPONENTS: ComponentEntry[] = [
  // ── 动作 (3) — carried over ────────────────────────────────────────────
  {
    group: "动作",
    name: "Button",
    states: INTERACTIVE_LOADING,
    variants: ["primary", "secondary", "ghost", "danger"],
  },
  {
    group: "动作",
    name: "Icon Button",
    states: INTERACTIVE,
  },
  {
    group: "动作",
    name: "Link",
    states: ["default", "hover", "focus", "disabled"],
  },

  // ── 表单 (6) — carried over ────────────────────────────────────────────
  {
    group: "表单",
    name: "Text Input",
    states: FORM_INPUT,
  },
  {
    group: "表单",
    name: "Textarea",
    states: FORM_INPUT,
  },
  {
    group: "表单",
    name: "Select",
    states: FORM_INPUT,
  },
  {
    group: "表单",
    name: "Checkbox",
    states: ["default", "hover", "focus", "disabled"],
  },
  {
    group: "表单",
    name: "Radio",
    states: ["default", "hover", "focus", "disabled"],
  },
  {
    group: "表单",
    name: "Switch",
    states: ["default", "hover", "focus", "disabled"],
  },

  // ── 数据展示 (3) — Card/Badge/Avatar explicitly carried over ──────────
  {
    group: "数据展示",
    name: "Card",
    states: ["default", "hover"],
  },
  {
    group: "数据展示",
    name: "Badge/Tag",
    states: ["default"],
  },
  {
    group: "数据展示",
    name: "Avatar",
    states: ["default"],
  },

  // ── 导航/交互 (7) — mobile replacements ───────────────────────────────
  // Replaces web 导航 (Header/Sidebar/Breadcrumb/Tabs/Pagination) +
  //          web Drawer/Action menus.
  {
    group: "导航/交互",
    name: "Bottom Tab Bar",
    states: ["default"],
  },
  {
    group: "导航/交互",
    name: "Top App Bar",
    states: ["default"],
  },
  {
    group: "导航/交互",
    name: "List Row",
    states: ["default", "hover"],
  },
  {
    group: "导航/交互",
    name: "Action Sheet",
    states: ["default"],
  },
  {
    group: "导航/交互",
    name: "Segmented Control",
    states: ["default", "focus"],
  },
  {
    group: "导航/交互",
    name: "FAB",
    states: INTERACTIVE,
  },
  {
    group: "导航/交互",
    name: "Pull-to-refresh",
    states: ["default", "loading"],
  },

  // ── 反馈/浮层 (4) — Toast/Alert/Progress/Skeleton carried over ─────────
  // Modal/Dialog and Drawer are omitted (not listed in the raw carry-over text).
  {
    group: "反馈/浮层",
    name: "Toast",
    states: ["default"],
  },
  {
    group: "反馈/浮层",
    name: "Alert/Banner",
    states: FEEDBACK,
    variants: ["info", "success", "warning", "error"],
  },
  {
    group: "反馈/浮层",
    name: "Progress/Spinner",
    states: ["default", "loading"],
  },
  {
    group: "反馈/浮层",
    name: "Skeleton",
    states: ["default", "loading"],
  },

  // ── 通用三态 (3) — carried over ────────────────────────────────────────
  {
    group: "通用三态",
    name: "Empty",
    states: ["empty"],
  },
  {
    group: "通用三态",
    name: "Loading",
    states: ["loading"],
  },
  {
    group: "通用三态",
    name: "Error",
    states: ["error"],
  },
];

// ---------------------------------------------------------------------------
// Shared foundation descriptor (same category set for both platforms;
// concrete token values come from brand_style at generation time).
// ---------------------------------------------------------------------------

const FOUNDATIONS: ComponentBaselineFoundations = {
  color: "color-token-visualization",
  typography: "typography-token-visualization",
  spacing: "spacing-token-visualization",
  radius: "radius-token-visualization",
  elevation: "elevation-token-visualization",
  motion: "motion-token-visualization",
  functionalIconStyle: "functional-icon-style-visualization",
};

// ---------------------------------------------------------------------------
// Shared product icon spec
// ---------------------------------------------------------------------------

const PRODUCT_ICON: ProductIconSpec = {
  variants: ["primary", "monochrome"],
  derivation: "productName+brandStyle",
  shapeStability: "reuse-geometry-recolor",
};

// ---------------------------------------------------------------------------
// Exported constant — SPEC-DATA-003
// ---------------------------------------------------------------------------

export const COMPONENT_BASELINES: Record<ComponentPlatform, ComponentBaselineSpec> = {
  web: {
    foundations: FOUNDATIONS,
    productIcon: PRODUCT_ICON,
    components: WEB_COMPONENTS,
  },
  mobile: {
    foundations: FOUNDATIONS,
    productIcon: PRODUCT_ICON,
    components: MOBILE_COMPONENTS,
  },
};
