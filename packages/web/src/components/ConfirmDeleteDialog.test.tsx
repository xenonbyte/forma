// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";

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
});

describe("ConfirmDeleteDialog", () => {
  it("renders product identity and deletion scope", () => {
    const html = renderToStaticMarkup(
      <ConfirmDeleteDialog
        onCancel={() => undefined}
        onConfirm={() => undefined}
        open={true}
        product={{ id: "P-123abc", name: "Checkout App" }}
      />,
    );

    expect(html).toContain("Checkout App");
    expect(html).toContain("P-123abc");
    expect(html).toContain("Requirements, baseline, designs, sessions, and generated assets");
  });

  it("requires exact product ID before confirming", async () => {
    const onConfirm = vi.fn();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <ConfirmDeleteDialog
          onCancel={() => undefined}
          onConfirm={onConfirm}
          open={true}
          product={{ id: "P-123abc", name: "Checkout App" }}
        />,
      );
      await flushPromises();
    });

    const input = required(
      container.querySelector<HTMLInputElement>('input[name="confirm_product_id"]'),
      "confirmation input",
    );
    const button = required(
      container.querySelector<HTMLButtonElement>('[data-confirm-delete-final="true"]'),
      "final delete button",
    );

    expect(button.disabled).toBe(true);

    await act(async () => {
      setInputValue(input, "p-123abc");
      await flushPromises();
    });
    expect(button.disabled).toBe(true);

    await act(async () => {
      setInputValue(input, " P-123abc ");
      await flushPromises();
    });
    expect(button.disabled).toBe(true);

    await act(async () => {
      setInputValue(input, "P-123abc");
      await flushPromises();
    });
    expect(button.disabled).toBe(false);

    await act(async () => {
      button.click();
      await flushPromises();
    });

    expect(onConfirm).toHaveBeenCalledWith("P-123abc");
  });

  it("passes the typed confirmation value to the confirm callback", async () => {
    const onConfirm = vi.fn();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <ConfirmDeleteDialog
          onCancel={() => undefined}
          onConfirm={onConfirm}
          open={true}
          product={{ id: "P-123abc", name: "Checkout App" }}
        />,
      );
      await flushPromises();
    });

    await act(async () => {
      setInputValue(
        required(container.querySelector<HTMLInputElement>('input[name="confirm_product_id"]'), "confirmation input"),
        "P-123abc",
      );
      required(
        container.querySelector<HTMLButtonElement>('[data-confirm-delete-final="true"]'),
        "final delete button",
      ).click();
      await flushPromises();
    });

    expect(onConfirm).toHaveBeenCalledWith("P-123abc");
  });

  it("cancels from Escape and close button", async () => {
    const onCancel = vi.fn();
    const { container, root } = createTestRoot();

    await act(async () => {
      root.render(
        <ConfirmDeleteDialog
          onCancel={onCancel}
          onConfirm={() => undefined}
          open={true}
          product={{ id: "P-123abc", name: "Checkout App" }}
        />,
      );
      await flushPromises();
    });

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flushPromises();
    });
    required(container.querySelector<HTMLButtonElement>('[aria-label="Close"]'), "close button").click();

    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

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

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
