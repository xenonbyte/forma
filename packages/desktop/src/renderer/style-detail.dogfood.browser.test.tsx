// P9.6 dogfood — 风格详情 (brand-style detail).
// Drives the real AppShell into a style selection (hash deep-link) so WorkspacePane
// renders <StyleDetail> with the 3-file brand content (DESIGN.md / tokens.css in
// <pre>, components.html in a sandboxed iframe). The iframe document is NOT walked by
// extractSnapshotInPage, so only the shell chrome + the DESIGN.md/tokens.css text is
// linted. The viewer tile is mocked (not reached for a style selection).
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
      pages: [{ page_id: "login", name: "登录页" }],
    }),
    listArtifacts: vi.fn().mockResolvedValue({ artifacts: [] }),
    formaServerBaseUrl: vi.fn().mockResolvedValue("http://127.0.0.1:3000"),
    listStyles: vi.fn().mockResolvedValue([{ name: "clean", description: "Clean brand" }]),
    getStyle: vi.fn().mockResolvedValue({
      kind: "brand",
      metadata: { name: "clean", description: "Clean brand" },
      designMd: "# Clean 设计语言\n\n克制、清晰、以内容为先。",
      tokensCss: ":root {\n  --accent: #111111;\n  --bg: #ffffff;\n}",
      componentsHtml: "<button>主操作</button>",
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

describe("dogfood: 风格详情", () => {
  it("shell chrome + StyleDetail (DESIGN.md/tokens.css) passes all craft-lint rules", async () => {
    installForma();
    window.location.hash = "#/styles/clean";
    const container = render(<AppShell />);
    await flush();
    await flush();

    // Style detail is mounted: title + the 3-file section content rendered.
    expect(container.querySelector(".style-detail__title")).not.toBeNull();
    expect(container.textContent).toContain("# Clean 设计语言");
    // theme.css applied: the <pre> uses the mono token, the title uses Inter display.
    const title = container.querySelector(".style-detail__title") as Element;
    expect(getComputedStyle(title).fontFamily.toLowerCase()).toContain("inter");

    const checks = lintCraft(extractSnapshotInPage());
    const ids = checks.map((c) => c.id).sort();
    expect(ids).toEqual(["color-palette", "contrast-aa", "font-families", "type-scale"]);
    for (const c of checks) {
      expect(c.passed, `${c.id}: ${c.detail ?? ""}`).toBe(true);
    }
  });
});
