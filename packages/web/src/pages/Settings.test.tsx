// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../LocaleContext.js";
import { getLocale, setLocale } from "../i18n.js";
import { Settings } from "./Settings.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  setLocale("en");
});

describe("Settings", () => {
  it("renders the language switcher in the settings content area", async () => {
    setLocale("en");
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <LocaleProvider>
          <Settings />
        </LocaleProvider>,
      );
      await flushPromises();
    });

    expect(container.textContent).toContain("Language");
    const en = buttonByText(container, "EN");
    const zh = buttonByText(container, "中");
    expect(en.getAttribute("aria-pressed")).toBe("true");
    expect(zh.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      zh.click();
      await flushPromises();
    });

    expect(getLocale()).toBe("zh");
    expect(en.getAttribute("aria-pressed")).toBe("false");
    expect(zh.getAttribute("aria-pressed")).toBe("true");
  });
});

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
  if (!button) {
    throw new Error(`Missing button ${text}`);
  }
  return button;
}

function createTestRoot() {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
