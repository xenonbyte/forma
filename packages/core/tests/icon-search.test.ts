import { describe, expect, it } from "vitest";
import { FormaError } from "../src/errors.js";
import { type IconHit, searchIcons } from "../src/icon-search.js";

describe("searchIcons", () => {
  it("rejects an empty query", () => {
    expect(() => searchIcons("")).toThrow(FormaError);
    try {
      searchIcons("");
    } catch (error) {
      expect(error).toBeInstanceOf(FormaError);
      expect((error as FormaError).code).toBe("INVALID_INPUT");
    }
  });

  it("rejects a whitespace-only query", () => {
    expect(() => searchIcons("   ")).toThrow(FormaError);
    expect(() => searchIcons("\t\n")).toThrow(FormaError);
  });

  it("ranks name-prefix matches before substring matches", () => {
    const hits = searchIcons("arrow", 50);
    expect(hits.length).toBeGreaterThan(0);

    const firstPrefixIndex = hits.findIndex((hit) => hit.name.startsWith("arrow"));
    const firstSubstringOnlyIndex = hits.findIndex(
      (hit) => !hit.name.startsWith("arrow") && hit.name.includes("arrow"),
    );

    expect(firstPrefixIndex).toBe(0);
    if (firstSubstringOnlyIndex >= 0) {
      expect(firstPrefixIndex).toBeLessThan(firstSubstringOnlyIndex);
    }
  });

  it("returns alphabetically ordered results within the prefix tier", () => {
    const hits = searchIcons("arrow", 50).filter((hit) => hit.name.startsWith("arrow"));
    const names = hits.map((hit) => hit.name);
    expect(names).toEqual([...names].sort());
  });

  it("returns a tag-only hit when the name does not match the query", () => {
    // "wheelchair" is a tag of the "accessibility" icon but is not part of its name.
    const hits = searchIcons("wheelchair", 50);
    const names = hits.map((hit) => hit.name);
    expect(names).toContain("accessibility");
    expect(names.every((name) => !name.includes("wheelchair"))).toBe(true);
  });

  it("returns an empty array when nothing matches", () => {
    expect(searchIcons("zzzznotanicon-xyzzy")).toEqual([]);
  });

  it("defaults the limit to 10", () => {
    const hits = searchIcons("a");
    expect(hits.length).toBeLessThanOrEqual(10);
  });

  it("respects an explicit limit", () => {
    const hits = searchIcons("arrow", 3);
    expect(hits.length).toBe(3);
  });

  it("treats a non-positive limit as no results", () => {
    expect(searchIcons("arrow", 0)).toEqual([]);
  });

  it("returns hits shaped as { name, tags, svg } with raw SVG markup", () => {
    const [hit] = searchIcons("arrow", 1) as IconHit[];
    expect(hit).toBeDefined();
    expect(typeof hit.name).toBe("string");
    expect(hit.name.length).toBeGreaterThan(0);
    expect(Array.isArray(hit.tags)).toBe(true);
    expect(typeof hit.svg).toBe("string");
    expect(hit.svg).toContain("<svg");
    expect(hit.svg).toContain("currentColor");
  });

  it("matches an exact name and ranks it first", () => {
    const hits = searchIcons("house", 50);
    expect(hits[0]?.name).toBe("house");
  });

  it("is case-insensitive", () => {
    const lower = searchIcons("Arrow", 5).map((hit) => hit.name);
    const upper = searchIcons("ARROW", 5).map((hit) => hit.name);
    expect(lower).toEqual(upper);
  });
});
