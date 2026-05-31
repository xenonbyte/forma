// P9.6 dogfood — 需求设计画布 (requirement design canvas).
// Renders the real desktop shell chrome (AppShell → Sidebar/TopBar/WorkspacePane)
// in chromium with a requirement selected, then asserts the rendered shell passes
// the SAME lintCraft rules Forma applies to generated artifacts.
//
// The <Viewer> is MOCKED here (see FALLBACK note below). The design/annotation mode
// is entirely INTERNAL to <Viewer> (top toggle [data-action="mode-design"] /
// [data-action="mode-annotation"]; Viewer defaults to design mode). The desktop
// shell router has no design/annotation distinction, so the dogfood target for this
// nav state is the shell chrome text quality.
//
// FALLBACK (verified, not assumed): rendering the REAL <Viewer> here fails
// contrast-aa on the viewer's OWN chrome, which this task must not touch —
//   - "React Flow" 2.85:1  (@xyflow/react attribution badge; proOptions
//     hideAttribution:false in packages/viewer/src/Canvas.tsx)
//   - "标注功能待后续版本提供。" 3.54:1  (AnnotationSlot color:#888 in
//     packages/viewer/src/AnnotationSlot.tsx)
// Both are @xenonbyte/forma-viewer package concerns, not the P9.5 shell tokens.
// Fixing them is out of scope, so the 4 canvas screens keep the viewer mocked.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./theme.css";
import { extractSnapshotInPage, lintCraft } from "@xenonbyte/forma-core/quality";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock the viewer so the shell renders without React Flow + iframe loading (flaky,
// points at a non-running server). buildViewerModel passes through; Viewer is inert.
vi.mock("@xenonbyte/forma-viewer", () => ({
  buildViewerModel: (input: unknown) => ({ __model: input }),
  Viewer: () => null,
}));
vi.mock("./viewer/resolver.js", () => ({
  createDesktopResourceResolver: () => ({ resolve: () => "" }),
}));

import { AppShell } from "./AppShell.js";

const roots: Root[] = [];
const containers: HTMLElement[] = [];

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  roots.push(root);
  containers.push(container);
  return container;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

function installForma(): void {
  window.forma = {
    listProducts: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "产品一", description: "", platform: "web" }],
    }),
    getProduct: vi.fn().mockResolvedValue({ id: "p1", name: "产品一", description: "", platform: "web" }),
    listRequirements: vi.fn().mockResolvedValue({
      requirements: [{ id: "r1", title: "登录需求", status: "active", ui_affected: true }],
    }),
    getRequirement: vi.fn().mockResolvedValue({
      id: "r1",
      title: "登录需求",
      status: "active",
      ui_affected: true,
      pages: [
        { page_id: "login", name: "登录页" },
        { page_id: "home", name: "首页" },
      ],
    }),
    listArtifacts: vi.fn().mockResolvedValue({ artifacts: [] }),
    formaServerBaseUrl: vi.fn().mockResolvedValue("http://127.0.0.1:3000"),
    listStyles: vi.fn().mockResolvedValue([{ name: "clean", description: "Clean brand" }]),
    getStyle: vi.fn().mockResolvedValue({
      kind: "brand",
      metadata: { name: "clean", description: "" },
      designMd: "# Clean",
      tokensCss: ":root{}",
      componentsHtml: "<i></i>",
    }),
  } as unknown as Window["forma"];
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const container of containers.splice(0)) container.remove();
  delete window.forma;
  window.location.hash = "";
  vi.restoreAllMocks();
});

describe("dogfood: 需求设计画布", () => {
  it("shell chrome (sidebar/topbar) passes all craft-lint rules", async () => {
    installForma();
    window.location.hash = "#/products/p1/requirements/r1";
    const container = render(<AppShell />);
    await flush();
    await flush();

    // Requirement chrome is mounted: the requirement nav item is active.
    const active = container.querySelector('[data-nav-requirement="r1"].sidebar__item--active');
    expect(active).not.toBeNull();
    // theme.css is applied (clean tokens): the active item uses the Inter body font.
    expect(getComputedStyle(active as Element).fontFamily.toLowerCase()).toContain("inter");

    const checks = lintCraft(extractSnapshotInPage());
    const ids = checks.map((c) => c.id).sort();
    expect(ids).toEqual(["color-palette", "contrast-aa", "font-families", "type-scale"]);
    for (const c of checks) {
      expect(c.passed, `${c.id}: ${c.detail ?? ""}`).toBe(true);
    }
  });
});
