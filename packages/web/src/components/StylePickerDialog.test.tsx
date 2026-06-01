// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrandStyleContent, Platform, StyleMetadata } from "../api.js";
import { StylePickerDialog } from "./StylePickerDialog.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const styles: StyleMetadata[] = [
  {
    name: "linear",
    description: "Focused tool UI",
    design_md_path: "styles/linear/DESIGN.md",
    tokens_css_path: "styles/linear/tokens.css",
    components_html_path: "styles/linear/components.html"
  },
  {
    name: "retail",
    description: "Retail checkout UI",
    design_md_path: "styles/retail/DESIGN.md",
    tokens_css_path: "styles/retail/tokens.css",
    components_html_path: "styles/retail/components.html"
  }
];

const detailByName: Record<string, BrandStyleContent> = {
  linear: {
    kind: "brand",
    metadata: styles[0]!,
    designMd: `---
colors:
  primary: "#5E6AD2"
---
`,
    tokensCss: ":root { --primary: #5E6AD2; }",
    componentsHtml: "<div>linear</div>"
  },
  retail: {
    kind: "brand",
    metadata: styles[1]!,
    designMd: `---
colors:
  primary: "#14b8a6"
---
`,
    tokensCss: ":root { --primary: #14b8a6; }",
    componentsHtml: "<div>retail</div>"
  }
};

const roots: Root[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("StylePickerDialog", () => {
  it("opens without a selected platform because the preview shows every platform", async () => {
    const onConfirm = vi.fn();
    const getStyle = vi.fn(async (name: string) => detailByName[name]!);
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StylePickerDialog getStyle={getStyle} onConfirm={onConfirm} platform="" selectedStyleName="" styles={styles} />);
      await flushMicrotasks();
    });

    const trigger = required(container.querySelector<HTMLButtonElement>("[data-style-picker-trigger]"), "style picker trigger");
    expect(trigger.disabled).toBe(false);

    await act(async () => {
      trigger.click();
      await flushMicrotasks();
    });

    const dialog = required(document.body.querySelector<HTMLElement>('[data-style-picker-dialog="true"]'), "style picker dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(getStyle).toHaveBeenCalledWith("linear");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders compact candidate cards without the old search field", async () => {
    const { container } = await renderOpenPicker();

    expect(document.body.querySelector("[data-style-picker-search]")).toBeNull();
    const options = Array.from(document.body.querySelectorAll<HTMLElement>("[data-style-picker-option]"));
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toContain("Linear");
    expect(options[1]?.textContent).toContain("Retail");
  });

  it("confirms the active candidate without mutating the committed value before confirm", async () => {
    const onConfirm = vi.fn();
    const { container } = await renderOpenPicker({ onConfirm, selectedStyleName: "linear" });

    expect(required(document.body.querySelector<HTMLElement>('[data-style-preview-grid="true"]'), "preview grid").dataset.previewTemplateName).toBe("linear");
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => {
      required(document.body.querySelector<HTMLButtonElement>("[data-style-picker-confirm]"), "confirm button").click();
      await flushMicrotasks();
    });

    expect(onConfirm).toHaveBeenCalledWith("linear");
  });

  it("changes the active candidate and renders the preview from that candidate template data", async () => {
    const onConfirm = vi.fn();
    const getStyle = vi.fn(async (name: string) => detailByName[name]!);
    const { container } = await renderOpenPicker({ getStyle, onConfirm, selectedStyleName: "linear" });

    const previewBefore = required(document.body.querySelector<HTMLElement>('[data-style-preview-grid="true"]'), "preview grid");
    expect(previewBefore.dataset.previewTemplateName).toBe("linear");
    expect(previewBefore.dataset.primary).toBe("#5E6AD2");
    expect(optionButton(container, "linear").getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      optionButton(container, "retail").click();
      await flushMicrotasks();
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(getStyle).toHaveBeenCalledWith("retail");
    expect(optionButton(container, "linear").getAttribute("aria-selected")).toBe("false");
    expect(optionButton(container, "retail").getAttribute("aria-selected")).toBe("true");
    const previewAfter = required(document.body.querySelector<HTMLElement>('[data-style-preview-grid="true"]'), "preview grid");
    expect(previewAfter.dataset.previewTemplateName).toBe("retail");
    expect(previewAfter.dataset.primary).toBe("#14b8a6");

    await act(async () => {
      required(document.body.querySelector<HTMLButtonElement>("[data-style-picker-confirm]"), "confirm button").click();
      await flushMicrotasks();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("retail");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes with cancel, close button, and Escape without submitting", async () => {
    const onConfirm = vi.fn();
    const { container } = await renderPicker({ onConfirm, platform: "web" });

    await openPicker(container);
    await act(async () => {
      optionButton(container, "retail").click();
      await flushMicrotasks();
    });
    await act(async () => {
      required(document.body.querySelector<HTMLButtonElement>("[data-style-picker-cancel]"), "cancel button").click();
      await flushMicrotasks();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    await openPicker(container);
    await act(async () => {
      required(document.body.querySelector<HTMLButtonElement>("[data-style-picker-close]"), "close button").click();
      await flushMicrotasks();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    await openPicker(container);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await flushMicrotasks();
    });

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("loads style detail on demand and reuses cached style detail by name", async () => {
    const getStyle = vi.fn(async (name: string) => detailByName[name]!);
    const { container } = await renderOpenPicker({ getStyle, selectedStyleName: "linear" });

    expect(getStyle).toHaveBeenCalledTimes(1);
    expect(getStyle).toHaveBeenCalledWith("linear");

    await act(async () => {
      optionButton(container, "retail").click();
      await flushMicrotasks();
    });

    await act(async () => {
      optionButton(container, "linear").click();
      await flushMicrotasks();
    });

    expect(getStyle).toHaveBeenCalledTimes(2);
    expect(getStyle).toHaveBeenNthCalledWith(2, "retail");

    await act(async () => {
      required(document.body.querySelector<HTMLButtonElement>("[data-style-picker-cancel]"), "cancel button").click();
      await flushMicrotasks();
    });
    await openPicker(container);

    expect(getStyle).toHaveBeenCalledTimes(2);
  });

  it("renders all four platform previews regardless of selected platform", async () => {
    const { container } = await renderOpenPicker({ platform: "tablet" });

    expect(Array.from(document.body.querySelectorAll<HTMLElement>("[data-preview-mock]")).map((mock) => mock.dataset.previewMock).sort()).toEqual([
      "desktop",
      "mobile",
      "tablet",
      "web"
    ]);

    await act(async () => {
      optionButton(container, "retail").click();
      await flushMicrotasks();
    });

    expect(Array.from(document.body.querySelectorAll<HTMLElement>("[data-preview-mock]")).map((mock) => mock.dataset.previewMock).sort()).toEqual([
      "desktop",
      "mobile",
      "tablet",
      "web"
    ]);
  });

  it("focuses the first option on open and restores focus to the trigger on close", async () => {
    const { container } = await renderPicker({ platform: "web" });
    const trigger = required(container.querySelector<HTMLButtonElement>("[data-style-picker-trigger]"), "style picker trigger");

    await openPicker(container);

    expect(document.activeElement).toBe(required(document.body.querySelector<HTMLButtonElement>('[data-style-picker-option="linear"]'), "first style option"));

    await act(async () => {
      required(document.body.querySelector<HTMLButtonElement>("[data-style-picker-cancel]"), "cancel button").click();
      await flushMicrotasks();
    });

    expect(document.activeElement).toBe(trigger);
  });
});

async function renderOpenPicker(props: Partial<StylePickerProps> = {}) {
  const rendered = await renderPicker(props);
  await openPicker(rendered.container);
  return rendered;
}

interface StylePickerProps {
  getStyle: (name: string) => Promise<BrandStyleContent>;
  onConfirm: (name: string) => void;
  platform: Platform | "";
  selectedStyleName: string;
}

async function renderPicker(props: Partial<StylePickerProps> = {}) {
  const { container, root } = createTestRoot();
  const getStyle = props.getStyle ?? vi.fn(async (name: string) => detailByName[name]!);
  const onConfirm = props.onConfirm ?? vi.fn();

  await act(async () => {
    root.render(
      <StylePickerDialog
        getStyle={getStyle}
        onConfirm={onConfirm}
        platform={props.platform ?? "web"}
        selectedStyleName={props.selectedStyleName ?? ""}
        styles={styles}
      />
    );
    await flushMicrotasks();
  });

  return { container, getStyle, onConfirm, root };
}

async function openPicker(container: HTMLElement) {
  await act(async () => {
    required(container.querySelector<HTMLButtonElement>("[data-style-picker-trigger]"), "style picker trigger").click();
    await flushMicrotasks();
  });
}

function optionButton(_container: HTMLElement, name: string): HTMLButtonElement {
  return required(document.body.querySelector<HTMLButtonElement>(`[data-style-picker-option="${name}"]`), `${name} option`);
}

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

function required<T extends Element>(element: T | null, label: string): T {
  if (!element) {
    throw new Error(`Missing ${label}`);
  }
  return element;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
