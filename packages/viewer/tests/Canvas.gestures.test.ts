import { describe, it, expect } from "vitest";
import { CANVAS_INTERACTION_PROPS } from "../src/canvas-interaction.js";

describe("CANVAS_INTERACTION_PROPS", () => {
  it("pans on two-finger scroll and zooms on pinch (Figma standard)", () => {
    expect(CANVAS_INTERACTION_PROPS.panOnScroll).toBe(true);
    expect(CANVAS_INTERACTION_PROPS.panOnScrollMode).toBe("free");
    expect(CANVAS_INTERACTION_PROPS.zoomOnScroll).toBe(false);
    expect(CANVAS_INTERACTION_PROPS.zoomOnPinch).toBe(true);
    expect(CANVAS_INTERACTION_PROPS.panOnDrag).toBe(true);
    expect(CANVAS_INTERACTION_PROPS.zoomOnDoubleClick).toBe(false);
  });
});
