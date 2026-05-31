// P9.6 dogfood — 断连遮罩 (disconnected gate overlay).
// Renders the real ConnectionGate in the disconnected state (injected checkStatus
// resolves false) so the full-screen overlay chrome (title / body / retry button) is
// painted, then lints that chrome against the craft rules.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import "./theme.css";
import { extractSnapshotInPage, lintCraft } from "@xenonbyte/forma-core/quality";
import { ConnectionGate } from "./ConnectionGate.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const container of containers.splice(0)) container.remove();
});

describe("dogfood: 断连遮罩", () => {
  it("disconnected gate overlay passes all craft-lint rules", async () => {
    const container = render(
      <ConnectionGate checkStatus={() => Promise.resolve(false)}>
        <div data-testid="app">应用内容</div>
      </ConnectionGate>
    );
    await flush();

    // Disconnected overlay is mounted (not the children).
    const gate = container.querySelector('[data-gate="disconnected"]');
    expect(gate).not.toBeNull();
    expect(container.querySelector('[data-testid="app"]')).toBeNull();
    // theme.css applied: the gate title uses the Inter display token.
    const title = container.querySelector(".gate__title") as Element;
    expect(getComputedStyle(title).fontFamily.toLowerCase()).toContain("inter");

    const checks = lintCraft(extractSnapshotInPage());
    const ids = checks.map((c) => c.id).sort();
    expect(ids).toEqual(["color-palette", "contrast-aa", "font-families", "type-scale"]);
    for (const c of checks) {
      expect(c.passed, `${c.id}: ${c.detail ?? ""}`).toBe(true);
    }
  });
});
