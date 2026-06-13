import { describe, expect, it } from "vitest";
import {
  COMPONENT_BASELINES,
  type ComponentBaselineSpec,
  type ComponentPlatform,
} from "../src/component-baseline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGroup(spec: ComponentBaselineSpec, group: string) {
  return spec.components.filter((c) => c.group === group);
}

function names(spec: ComponentBaselineSpec, group: string): string[] {
  return getGroup(spec, group).map((c) => c.name);
}

// ---------------------------------------------------------------------------
// Type-level smoke tests
// ---------------------------------------------------------------------------

it("ComponentPlatform type is a union of 'web' | 'mobile'", () => {
  const p1: ComponentPlatform = "web";
  const p2: ComponentPlatform = "mobile";
  expect(p1).toBe("web");
  expect(p2).toBe("mobile");
});

it("COMPONENT_BASELINES has exactly 'web' and 'mobile' keys", () => {
  const keys = Object.keys(COMPONENT_BASELINES).sort();
  expect(keys).toEqual(["mobile", "web"]);
});

// ---------------------------------------------------------------------------
// Foundations
// ---------------------------------------------------------------------------

describe("foundations (both platforms)", () => {
  const foundationFields = [
    "color",
    "typography",
    "spacing",
    "radius",
    "elevation",
    "motion",
    "functionalIconStyle",
  ] as const;

  for (const platform of ["web", "mobile"] as ComponentPlatform[]) {
    it(`${platform}: foundations has all 7 required fields`, () => {
      const { foundations } = COMPONENT_BASELINES[platform];
      for (const field of foundationFields) {
        expect(foundations).toHaveProperty(field);
      }
      expect(Object.keys(foundations)).toHaveLength(7);
    });
  }
});

// ---------------------------------------------------------------------------
// Product icon spec RETIRED (PLAN-TASK-022 / D6).
// The icon unit is removed from the baseline; the app icon now flows through
// fm-app-icon → brand assets. The baseline must NOT carry a productIcon spec.
// ---------------------------------------------------------------------------

describe("productIcon spec removed (both platforms)", () => {
  for (const platform of ["web", "mobile"] as ComponentPlatform[]) {
    it(`${platform}: baseline has no productIcon spec`, () => {
      expect(COMPONENT_BASELINES[platform]).not.toHaveProperty("productIcon");
    });
  }
});

// ---------------------------------------------------------------------------
// Web component list — 6 groups, locked enumeration
// ---------------------------------------------------------------------------

describe("web components — 动作 group", () => {
  const group = "动作";
  it("contains exactly Button, Icon Button, Link (3 items)", () => {
    expect(names(COMPONENT_BASELINES.web, group)).toEqual([
      "Button",
      "Icon Button",
      "Link",
    ]);
  });

  it("Button has variants primary/secondary/ghost/danger", () => {
    const btn = COMPONENT_BASELINES.web.components.find(
      (c) => c.group === group && c.name === "Button",
    );
    expect(btn?.variants).toEqual(["primary", "secondary", "ghost", "danger"]);
  });
});

describe("web components — 表单 group", () => {
  const group = "表单";
  it("contains exactly Text Input, Textarea, Select, Checkbox, Radio, Switch (6 items)", () => {
    expect(names(COMPONENT_BASELINES.web, group)).toEqual([
      "Text Input",
      "Textarea",
      "Select",
      "Checkbox",
      "Radio",
      "Switch",
    ]);
  });
});

describe("web components — 数据展示 group", () => {
  const group = "数据展示";
  it("contains exactly Card, List/List Item, Table, Badge/Tag, Avatar, Tooltip (6 items)", () => {
    expect(names(COMPONENT_BASELINES.web, group)).toEqual([
      "Card",
      "List/List Item",
      "Table",
      "Badge/Tag",
      "Avatar",
      "Tooltip",
    ]);
  });
});

describe("web components — 导航 group", () => {
  const group = "导航";
  it("contains exactly Header/顶栏, Sidebar/菜单, Breadcrumb, Tabs, Pagination (5 items)", () => {
    expect(names(COMPONENT_BASELINES.web, group)).toEqual([
      "Header/顶栏",
      "Sidebar/菜单",
      "Breadcrumb",
      "Tabs",
      "Pagination",
    ]);
  });
});

describe("web components — 反馈/浮层 group", () => {
  const group = "反馈/浮层";
  it("contains exactly Alert/Banner, Toast, Modal/Dialog, Drawer, Progress/Spinner, Skeleton (6 items)", () => {
    expect(names(COMPONENT_BASELINES.web, group)).toEqual([
      "Alert/Banner",
      "Toast",
      "Modal/Dialog",
      "Drawer",
      "Progress/Spinner",
      "Skeleton",
    ]);
  });

  it("Alert/Banner has variants info/success/warning/error", () => {
    const alert = COMPONENT_BASELINES.web.components.find(
      (c) => c.group === group && c.name === "Alert/Banner",
    );
    expect(alert?.variants).toEqual(["info", "success", "warning", "error"]);
  });
});

describe("web components — 通用三态 group", () => {
  const group = "通用三态";
  it("contains exactly Empty, Loading, Error (3 items)", () => {
    expect(names(COMPONENT_BASELINES.web, group)).toEqual([
      "Empty",
      "Loading",
      "Error",
    ]);
  });
});

describe("web components — totals", () => {
  it("has exactly 6 groups", () => {
    const groups = [...new Set(COMPONENT_BASELINES.web.components.map((c) => c.group))];
    expect(groups).toHaveLength(6);
  });

  it("has exactly 29 components total", () => {
    // 动作(3) + 表单(6) + 数据展示(6) + 导航(5) + 反馈/浮层(6) + 通用三态(3) = 29
    expect(COMPONENT_BASELINES.web.components).toHaveLength(29);
  });
});

// ---------------------------------------------------------------------------
// All web components have non-empty states
// ---------------------------------------------------------------------------

describe("web components — states", () => {
  it("every component has at least one state", () => {
    for (const c of COMPONENT_BASELINES.web.components) {
      expect(c.states.length, `${c.group}/${c.name} must have non-empty states`).toBeGreaterThan(0);
    }
  });

  it("all states are within the canonical set", () => {
    const canonical = new Set([
      "default",
      "hover",
      "focus",
      "disabled",
      "loading",
      "empty",
      "error",
    ]);
    for (const c of COMPONENT_BASELINES.web.components) {
      for (const s of c.states) {
        expect(canonical, `${c.group}/${c.name} has unknown state "${s}"`).toContain(s);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Mobile — navigation/interaction replacement group
// ---------------------------------------------------------------------------

describe("mobile components — navigation/interaction replacement", () => {
  const group = "导航/交互";
  it("contains exactly the 7 mobile nav replacements", () => {
    expect(names(COMPONENT_BASELINES.mobile, group)).toEqual([
      "Bottom Tab Bar",
      "Top App Bar",
      "List Row",
      "Action Sheet",
      "Segmented Control",
      "FAB",
      "Pull-to-refresh",
    ]);
  });
});

describe("mobile components — carried-over 动作 group", () => {
  const group = "动作";
  it("carries over Button, Icon Button, Link", () => {
    expect(names(COMPONENT_BASELINES.mobile, group)).toEqual([
      "Button",
      "Icon Button",
      "Link",
    ]);
  });
});

describe("mobile components — carried-over 表单 group", () => {
  const group = "表单";
  it("carries over all 6 form components", () => {
    expect(names(COMPONENT_BASELINES.mobile, group)).toEqual([
      "Text Input",
      "Textarea",
      "Select",
      "Checkbox",
      "Radio",
      "Switch",
    ]);
  });
});

describe("mobile components — carried-over 数据展示 group", () => {
  const group = "数据展示";
  it("carries over Card, Badge/Tag, Avatar (raw-text explicit carry-overs only)", () => {
    // Raw text names: Card/Badge/Avatar explicitly. List/Table/Tooltip not named.
    expect(names(COMPONENT_BASELINES.mobile, group)).toEqual([
      "Card",
      "Badge/Tag",
      "Avatar",
    ]);
  });
});

describe("mobile components — carried-over 反馈/浮层 group", () => {
  const group = "反馈/浮层";
  it("carries over Toast, Alert/Banner, Progress/Spinner, Skeleton (raw-text explicit)", () => {
    expect(names(COMPONENT_BASELINES.mobile, group)).toEqual([
      "Toast",
      "Alert/Banner",
      "Progress/Spinner",
      "Skeleton",
    ]);
  });
});

describe("mobile components — carried-over 通用三态 group", () => {
  const group = "通用三态";
  it("carries over Empty, Loading, Error", () => {
    expect(names(COMPONENT_BASELINES.mobile, group)).toEqual([
      "Empty",
      "Loading",
      "Error",
    ]);
  });
});

describe("mobile components — totals", () => {
  it("has exactly 6 groups", () => {
    const groups = [...new Set(COMPONENT_BASELINES.mobile.components.map((c) => c.group))];
    expect(groups).toHaveLength(6);
  });

  it("has exactly 26 components total", () => {
    // 动作(3) + 表单(6) + 数据展示(3) + 导航/交互(7) + 反馈/浮层(4) + 通用三态(3) = 26
    expect(COMPONENT_BASELINES.mobile.components).toHaveLength(26);
  });
});

describe("mobile components — states", () => {
  it("every component has at least one state", () => {
    for (const c of COMPONENT_BASELINES.mobile.components) {
      expect(c.states.length, `${c.group}/${c.name} must have non-empty states`).toBeGreaterThan(0);
    }
  });
});
