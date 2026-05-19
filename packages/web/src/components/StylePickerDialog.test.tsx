// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Platform, StyleDetailPayload, StyleMetadata } from "../api.js";
import { StylePickerDialog } from "./StylePickerDialog.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const styles: StyleMetadata[] = [
  {
    name: "linear",
    description: "Focused tool UI",
    design_md_path: "styles/linear/DESIGN.md",
    variables: {
      primary: "#111827",
      background: "#ffffff",
      "text-primary": "#222222",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "8px",
      "spacing-unit": "8px"
    }
  },
  {
    name: "retail",
    description: "Retail checkout UI",
    design_md_path: "styles/retail/DESIGN.md",
    variables: {
      primary: "#0f766e",
      background: "#f0fdfa",
      "text-primary": "#134e4a",
      "font-heading": "Inter",
      "font-body": "Inter",
      "border-radius": "12px",
      "spacing-unit": "10px"
    }
  }
];

const detailByName: Record<string, StyleDetailPayload> = {
  linear: {
    metadata: styles[0]!,
    designMd: `---
colors:
  primary: "#5E6AD2"
---
`
  },
  retail: {
    metadata: styles[1]!,
    designMd: `---
colors:
  primary: "#14b8a6"
---
`
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
  it("does not open while no platform is selected", async () => {
    const onConfirm = vi.fn();
    const getStyle = vi.fn(async (name: string) => detailByName[name]!);
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(<StylePickerDialog getStyle={getStyle} onConfirm={onConfirm} platform="" selectedStyleName="" styles={styles} />);
      await flushMicrotasks();
    });

    const trigger = required(container.querySelector<HTMLButtonElement>("[data-style-picker-trigger]"), "style picker trigger");
    expect(trigger.disabled).toBe(true);

    await act(async () => {
      trigger.click();
      await flushMicrotasks();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(getStyle).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("filters candidate styles through search", async () => {
    const { container } = await renderOpenPicker();

    await act(async () => {
      setInputValue(required(container.querySelector<HTMLInputElement>("[data-style-picker-search]"), "style search"), "retail");
      await flushMicrotasks();
    });

    const options = Array.from(container.querySelectorAll<HTMLElement>("[data-style-picker-option]"));
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("retail");
    expect(container.textContent).not.toContain("Focused tool UI");
  });

  it("moves the candidate to the visible search result before confirming", async () => {
    const onConfirm = vi.fn();
    const { container } = await renderOpenPicker({ onConfirm, selectedStyleName: "linear" });

    await act(async () => {
      setInputValue(required(container.querySelector<HTMLInputElement>("[data-style-picker-search]"), "style search"), "retail");
      await flushMicrotasks();
    });

    expect(required(container.querySelector<HTMLElement>('[data-style-preview-panel="true"]'), "preview panel").dataset.primary).toBe("#14b8a6");

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>("[data-style-picker-confirm]"), "confirm button").click();
      await flushMicrotasks();
    });

    expect(onConfirm).toHaveBeenCalledWith("retail");
  });

  it("changes only the candidate preview on style click and commits on confirm", async () => {
    const onConfirm = vi.fn();
    const { container } = await renderOpenPicker({ onConfirm, selectedStyleName: "linear" });

    expect(required(container.querySelector<HTMLElement>('[data-style-preview-panel="true"]'), "preview panel").dataset.primary).toBe("#5E6AD2");

    await act(async () => {
      optionButton(container, "retail").click();
      await flushMicrotasks();
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(required(container.querySelector<HTMLElement>('[data-style-preview-panel="true"]'), "preview panel").dataset.primary).toBe("#14b8a6");

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>("[data-style-picker-confirm]"), "confirm button").click();
      await flushMicrotasks();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("retail");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
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
      required(container.querySelector<HTMLButtonElement>("[data-style-picker-cancel]"), "cancel button").click();
      await flushMicrotasks();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await openPicker(container);
    await act(async () => {
      required(container.querySelector<HTMLButtonElement>("[data-style-picker-close]"), "close button").click();
      await flushMicrotasks();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await openPicker(container);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await flushMicrotasks();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
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
      required(container.querySelector<HTMLButtonElement>("[data-style-picker-cancel]"), "cancel button").click();
      await flushMicrotasks();
    });
    await openPicker(container);

    expect(getStyle).toHaveBeenCalledTimes(2);
  });

  it("retries a failed detail load after the dialog is reopened", async () => {
    const getStyle = vi
      .fn<(name: string) => Promise<StyleDetailPayload>>()
      .mockRejectedValueOnce(new Error("Temporary DESIGN.md failure"))
      .mockImplementation(async (name) => detailByName[name]!);
    const { container } = await renderOpenPicker({ getStyle, selectedStyleName: "retail" });

    expect(container.textContent).toContain("Temporary DESIGN.md failure");

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>("[data-style-picker-cancel]"), "cancel button").click();
      await flushMicrotasks();
    });
    await openPicker(container);

    expect(getStyle).toHaveBeenCalledTimes(2);
    expect(required(container.querySelector<HTMLElement>('[data-style-preview-panel="true"]'), "preview panel").dataset.primary).toBe("#14b8a6");
    expect(container.textContent).not.toContain("Temporary DESIGN.md failure");
  });

  it("deduplicates in-flight detail requests by style name", async () => {
    const getStyle = vi.fn<(name: string) => Promise<StyleDetailPayload>>(() => new Promise(() => undefined));
    const { container } = await renderOpenPicker({ getStyle, selectedStyleName: "linear" });

    await act(async () => {
      optionButton(container, "retail").click();
      await flushMicrotasks();
    });
    await act(async () => {
      optionButton(container, "linear").click();
      await flushMicrotasks();
    });

    expect(getStyle).toHaveBeenCalledTimes(2);
    expect(getStyle).toHaveBeenNthCalledWith(1, "linear");
    expect(getStyle).toHaveBeenNthCalledWith(2, "retail");
  });

  it("shows a detail-load warning while keeping the metadata fallback preview visible", async () => {
    const getStyle = vi.fn(async (name: string) => {
      if (name === "retail") {
        throw new Error("DESIGN.md unavailable");
      }
      return detailByName[name]!;
    });
    const { container } = await renderOpenPicker({ getStyle, selectedStyleName: "retail" });

    expect(container.textContent).toContain("DESIGN.md unavailable");
    const preview = required(container.querySelector<HTMLElement>('[data-style-preview-panel="true"]'), "preview panel");
    expect(preview.dataset.primary).toBe("#0f766e");
    expect(preview.dataset.previewType).toBe("web");
  });

  it("uses the selected platform as the fixed preview type", async () => {
    const { container } = await renderOpenPicker({ platform: "tablet" });

    expect(required(container.querySelector<HTMLElement>('[data-style-preview-panel="true"]'), "preview panel").dataset.previewType).toBe("tablet");

    await act(async () => {
      optionButton(container, "retail").click();
      await flushMicrotasks();
    });

    expect(required(container.querySelector<HTMLElement>('[data-style-preview-panel="true"]'), "preview panel").dataset.previewType).toBe("tablet");
  });

  it("focuses the search input on open and restores focus to the trigger on close", async () => {
    const { container } = await renderPicker({ platform: "web" });
    const trigger = required(container.querySelector<HTMLButtonElement>("[data-style-picker-trigger]"), "style picker trigger");

    await openPicker(container);

    expect(document.activeElement).toBe(required(container.querySelector<HTMLInputElement>("[data-style-picker-search]"), "style search"));

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>("[data-style-picker-cancel]"), "cancel button").click();
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
  getStyle: (name: string) => Promise<StyleDetailPayload>;
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

function optionButton(container: HTMLElement, name: string): HTMLButtonElement {
  return required(container.querySelector<HTMLButtonElement>(`[data-style-picker-option="${name}"]`), `${name} option`);
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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
