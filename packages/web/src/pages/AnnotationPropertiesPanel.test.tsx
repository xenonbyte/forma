// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IRElement } from "@vzi-core/renderer";
import {
  AnnotationPropertiesPanel,
  borderRadiusDisplay,
  cssColorToDisplay,
  elementKind,
  type AnnotationSelectedElement,
} from "./AnnotationPropertiesPanel.js";
import type { PageFrame } from "./annotation-adapter.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const echoT = (key: string) => key;

function el(over: Partial<IRElement>): IRElement {
  return {
    id: "e1",
    type: "container",
    bounds: { x: 0, y: 0, width: 100, height: 50 },
    styles: {},
    children: [],
    ...over,
  } as IRElement;
}

function frame(over: Partial<PageFrame> = {}): PageFrame {
  return {
    pageId: "home",
    artifactId: "A",
    variant: "default",
    title: "Home",
    x: 470,
    width: 390,
    height: 800,
    status: "ready",
    ...over,
  };
}

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(selected: AnnotationSelectedElement | null) {
  act(() => {
    root.render(<AnnotationPropertiesPanel selected={selected} t={echoT} />);
  });
}

describe("cssColorToDisplay", () => {
  it("converts opaque rgb()/rgba() to uppercase hex", () => {
    expect(cssColorToDisplay("rgb(51, 51, 51)")).toBe("#333333");
    expect(cssColorToDisplay("rgba(79, 70, 229, 1)")).toBe("#4F46E5");
  });
  it("keeps translucent and non-rgb values as-is (no fake precision)", () => {
    expect(cssColorToDisplay("rgba(0, 0, 0, 0.5)")).toBe("rgba(0, 0, 0, 0.5)");
    expect(cssColorToDisplay("#abcdef")).toBe("#ABCDEF");
    expect(cssColorToDisplay("linear-gradient(red, blue)")).toBe("linear-gradient(red, blue)");
  });
});

describe("borderRadiusDisplay", () => {
  it("hides zero/none radii in any common form", () => {
    expect(borderRadiusDisplay(undefined)).toBeUndefined();
    expect(borderRadiusDisplay("0px")).toBeUndefined();
    expect(borderRadiusDisplay("0px 0px 0px 0px")).toBeUndefined();
    expect(borderRadiusDisplay("0% 0%")).toBeUndefined();
    expect(borderRadiusDisplay("none")).toBeUndefined();
  });
  it("shows real radii as-is, including per-corner shorthands", () => {
    expect(borderRadiusDisplay("8px")).toBe("8px");
    expect(borderRadiusDisplay("8px 8px 0px 0px")).toBe("8px 8px 0px 0px");
    expect(borderRadiusDisplay("9999px")).toBe("9999px");
  });
});

describe("elementKind", () => {
  it("classifies svgData as icon ahead of the element type", () => {
    expect(elementKind(el({ type: "image", svgData: "<svg/>" }))).toBe("icon");
  });
  it("maps image/text/container types", () => {
    expect(elementKind(el({ type: "image" }))).toBe("image");
    expect(elementKind(el({ type: "text", textContent: "hi" }))).toBe("text");
    expect(elementKind(el({ type: "container" }))).toBe("container");
  });
});

describe("AnnotationPropertiesPanel", () => {
  it("shows an empty hint when nothing is selected", () => {
    render(null);
    const panel = container.querySelector('[data-testid="annotation-props-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("annotation.panel.empty");
    expect(container.querySelector('[data-testid="annotation-props-layout"]')).toBeNull();
  });

  it("text selection shows content, typography, and hex text color", () => {
    render({
      element: el({
        type: "text",
        bounds: { x: 470 + 92, y: 12, width: 177, height: 21 },
        textContent: "Application was reject",
        styles: {
          color: "rgb(51, 51, 51)",
          fontFamily: '"Roboto", sans-serif',
          fontSize: "18px",
          fontWeight: "400",
          lineHeight: "21px",
          letterSpacing: "0px",
          textAlign: "center",
        },
      }),
      frame: frame(),
    });
    expect(container.querySelector('[data-testid="annotation-props-kind"]')!.textContent).toBe(
      "annotation.panel.type.text",
    );
    expect(container.querySelector('[data-testid="annotation-props-content"]')!.textContent).toContain(
      "Application was reject",
    );
    const typography = container.querySelector('[data-testid="annotation-props-typography"]')!;
    expect(typography.textContent).toContain("Roboto");
    expect(typography.textContent).toContain("18px");
    expect(typography.textContent).toContain("400");
    expect(typography.textContent).toContain("center");
    expect(container.querySelector('[data-testid="annotation-props-colors"]')!.textContent).toContain("#333333");
    // 页内相对坐标:left = bounds.x - frame.x。
    const layout = container.querySelector('[data-testid="annotation-props-layout"]')!;
    expect(layout.textContent).toContain("92px");
    expect(layout.textContent).toContain("12px");
    // 文本没有可导出资源。
    expect(container.querySelector('[data-testid="annotation-props-export"]')).toBeNull();
  });

  it("image selection shows export download + preview pointing at the slice URL", () => {
    const src = "/api/products/P-abc123/artifacts/A/versions/1/bundle/assets/shield.png";
    render({
      element: el({ type: "image", bounds: { x: 470 + 146, y: 120, width: 98, height: 98 }, src }),
      frame: frame(),
    });
    expect(container.querySelector('[data-testid="annotation-props-kind"]')!.textContent).toBe(
      "annotation.panel.type.image",
    );
    const download = container.querySelector<HTMLAnchorElement>('[data-testid="annotation-props-download"]')!;
    expect(download.getAttribute("href")).toBe(src);
    expect(download.getAttribute("download")).toBe("shield.png");
    const preview = container.querySelector<HTMLImageElement>('[data-testid="annotation-props-preview"]')!;
    expect(preview.getAttribute("src")).toBe(src);
    const layout = container.querySelector('[data-testid="annotation-props-layout"]')!;
    expect(layout.textContent).toContain("98px");
    // 图片没有文字分区。
    expect(container.querySelector('[data-testid="annotation-props-typography"]')).toBeNull();
  });

  it("container selection exports a raster slice referenced by CSS background-image", () => {
    const src = "/api/products/P-abc123/artifacts/A/versions/1/bundle/assets/bg.png";
    render({
      element: el({
        type: "container",
        bounds: { x: 470, y: 0, width: 390, height: 800 },
        styles: { backgroundImage: `linear-gradient(#000, #111), url("${src}")` },
      }),
      frame: frame(),
    });
    const download = container.querySelector<HTMLAnchorElement>('[data-testid="annotation-props-download"]')!;
    expect(download).not.toBeNull();
    expect(download.getAttribute("href")).toBe(src);
    expect(download.getAttribute("download")).toBe("bg.png");
    const preview = container.querySelector<HTMLImageElement>('[data-testid="annotation-props-preview"]')!;
    expect(preview.getAttribute("src")).toBe(src);
  });

  it("rounded component selection shows its corner radius in layout; square ones do not", () => {
    render({
      element: el({
        type: "button",
        bounds: { x: 470 + 24, y: 700, width: 342, height: 48 },
        styles: { backgroundColor: "rgb(16, 24, 32)", borderRadius: "24px" },
      }),
      frame: frame(),
    });
    const layout = container.querySelector('[data-testid="annotation-props-layout"]')!;
    expect(layout.textContent).toContain("annotation.panel.radius");
    expect(layout.textContent).toContain("24px");

    render({
      element: el({
        type: "container",
        bounds: { x: 470, y: 0, width: 390, height: 800 },
        styles: { borderRadius: "0px" },
      }),
      frame: frame(),
    });
    expect(container.querySelector('[data-testid="annotation-props-layout"]')!.textContent).not.toContain(
      "annotation.panel.radius",
    );
  });

  it("container selection shows background color and layout only", () => {
    render({
      element: el({
        type: "container",
        bounds: { x: 470, y: 0, width: 390, height: 800 },
        styles: { backgroundColor: "rgb(255, 255, 255)" },
      }),
      frame: frame(),
    });
    expect(container.querySelector('[data-testid="annotation-props-kind"]')!.textContent).toBe(
      "annotation.panel.type.container",
    );
    expect(container.querySelector('[data-testid="annotation-props-colors"]')!.textContent).toContain("#FFFFFF");
    expect(container.querySelector('[data-testid="annotation-props-content"]')).toBeNull();
    expect(container.querySelector('[data-testid="annotation-props-export"]')).toBeNull();
  });
});
