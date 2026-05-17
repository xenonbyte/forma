import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DiffViewer, DiffViewerContent, type DiffViewerState } from "./DiffViewer.js";

describe("DiffViewer", () => {
  it("renders the loading state before API data is available", () => {
    const html = renderToStaticMarkup(<DiffViewer designId="D-12345678" fromVersion={1} toVersion={2} />);

    expect(html).toContain("Loading design diff");
  });

  it("renders an API error state", () => {
    const state: DiffViewerState = {
      error: { error_code: "HISTORY_FILE_MISSING", message: "Design history file is missing", status: 404 },
      status: "error"
    };

    const html = renderToStaticMarkup(<DiffViewerContent fromVersion={1} state={state} toVersion={2} />);

    expect(html).toContain("Diff unavailable");
    expect(html).toContain("HISTORY_FILE_MISSING");
    expect(html).toContain("Design history file is missing");
  });

  it("renders empty structural diff with side-by-side images", () => {
    const state: DiffViewerState = {
      diff: {
        added: [],
        removed: [],
        modified: [],
        visual: {
          from_image_url: "/api/designs/D-12345678/image/file?version=1",
          to_image_url: "/api/designs/D-12345678/image/file?version=2"
        }
      },
      status: "ready"
    };

    const html = renderToStaticMarkup(<DiffViewerContent fromVersion={1} state={state} toVersion={2} />);

    expect(html).toContain("No structural changes");
    expect(html).toContain('src="/api/designs/D-12345678/image/file?version=1"');
    expect(html).toContain('src="/api/designs/D-12345678/image/file?version=2"');
  });

  it("renders added, removed, and modified node rows", () => {
    const state: DiffViewerState = {
      diff: {
        added: [{ id: "new-cta", name: "New CTA", type: "button", x: 12, y: 20, width: 120, height: 40 }],
        removed: [{ id: "old-title", name: "Old title", type: "text", x: 20, y: 30, width: 200, height: 24 }],
        modified: [
          {
            id: "hero",
            before: { id: "hero", name: "Hero", type: "frame", x: 0, y: 0, width: 320, height: 240 },
            after: { id: "hero", name: "Hero", type: "frame", x: 0, y: 0, width: 360, height: 260 }
          }
        ],
        visual: {
          from_image_url: "/api/designs/D-12345678/image/file?version=1",
          to_image_url: "/api/designs/D-12345678/image/file?version=2"
        }
      },
      status: "ready"
    };

    const html = renderToStaticMarkup(<DiffViewerContent fromVersion={1} state={state} toVersion={2} />);

    expect(html).toContain("Added");
    expect(html).toContain("Removed");
    expect(html).toContain("Modified");
    expect(html).toContain("New CTA");
    expect(html).toContain("Old title");
    expect(html).toContain("320x240");
    expect(html).toContain("360x260");
  });
});
