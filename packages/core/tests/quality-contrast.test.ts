import { describe, expect, it } from "vitest";
import { relativeLuminance, contrastRatio, compositeOver } from "../src/quality/contrast.js";

describe("contrast math", () => {
  it("relativeLuminance: black = 0, white = 1", () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  it("contrastRatio: black vs white = 21:1", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it("contrastRatio is symmetric (order independent)", () => {
    const a = contrastRatio([10, 20, 30], [200, 210, 220]);
    const b = contrastRatio([200, 210, 220], [10, 20, 30]);
    expect(a).toBeCloseTo(b, 6);
  });

  it("contrastRatio: same color = 1:1", () => {
    expect(contrastRatio([120, 120, 120], [120, 120, 120])).toBeCloseTo(1, 6);
  });

  it("compositeOver: opaque fg returns fg unchanged", () => {
    expect(compositeOver([10, 20, 30, 1], [255, 255, 255])).toEqual([10, 20, 30]);
  });

  it("compositeOver: 50% black over white = mid grey", () => {
    expect(compositeOver([0, 0, 0, 0.5], [255, 255, 255])).toEqual([128, 128, 128]);
  });

  it("compositeOver: fully transparent fg returns bg", () => {
    expect(compositeOver([0, 0, 0, 0], [200, 210, 220])).toEqual([200, 210, 220]);
  });
});
