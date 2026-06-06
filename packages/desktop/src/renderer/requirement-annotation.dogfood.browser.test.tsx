// P9.6 dogfood — 需求标注画布 (requirement annotation canvas).
//
// IMPORTANT — the shell chrome here is INTENTIONALLY IDENTICAL to the requirement
// DESIGN canvas (requirement-design.dogfood.browser.test.tsx). design vs annotation
// is purely a MODE INSIDE <Viewer> (top toggle [data-action="mode-design"] /
// [data-action="mode-annotation"]); the desktop shell router has NO design/annotation
// distinction (same hash #/products/p1/requirements/r1, same Sidebar/TopBar/Workspace).
// So there is no shell-level difference to assert — the only thing that would differ
// is the viewer's internal canvas (design iframes vs annotation imgs).
//
// We KEEP this file (per the P9.6 fallback) to validate the shell chrome IN THE
// ANNOTATION NAV STATE. The viewer is MOCKED because rendering the REAL <Viewer>
// fails contrast-aa on the viewer's OWN chrome — "React Flow" 2.85:1 (@xyflow/react
// attribution, packages/viewer/src/Canvas.tsx) and "标注功能待后续版本提供。" 3.54:1
// (AnnotationSlot #888, packages/viewer/src/AnnotationSlot.tsx). Both are
// @xenonbyte/forma-viewer concerns, not the P9.5 shell tokens, and out of this
// task's scope — so this screen lints the shell chrome, not the viewer chrome.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./theme.css";
import { extractSnapshotInPage, lintCraft } from "@xenonbyte/forma-core/quality";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("dogfood: 需求标注画布", () => {
  it("shell chrome (sidebar/topbar) passes all craft-lint rules", async () => {
    installForma();
    window.location.hash = "#/products/p1/requirements/r1";
    const container = render(<AppShell />);
    await flush();
    await flush();

    const active = container.querySelector('[data-nav-requirement="r1"].sidebar__item--active');
    expect(active).not.toBeNull();
    expect(getComputedStyle(active as Element).fontFamily.toLowerCase()).toContain("inter");

    const checks = lintCraft(extractSnapshotInPage());
    const ids = checks.map((c) => c.id).sort();
    expect(ids).toEqual(["color-palette", "contrast-aa", "font-families", "screen-edge-radius", "type-scale"]);
    for (const c of checks) {
      expect(c.passed, `${c.id}: ${c.detail ?? ""}`).toBe(true);
    }
  });
});
