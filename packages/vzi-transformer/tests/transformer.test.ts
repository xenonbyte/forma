import { describe, expect, it } from "vitest";
import type { IntermediateRepresentation, IRElement } from "@vzi-core/types";
import { VZITransformer, transform, buildVziContentFromTransformResult, type TransformOptions } from "../src/index.js";

// Minimal IR factory: a root container with the given children. Bounds/styles
// are explicit so token extraction and canvas inference have something to work
// with. Keeps each test focused on one transformer contract.
function element(partial: Partial<IRElement> & Pick<IRElement, "id" | "type">): IRElement {
  return {
    parentId: null,
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    styles: {},
    ...partial,
  } as IRElement;
}

function makeIR(children: IRElement[] = []): IntermediateRepresentation {
  const root = element({
    id: "root",
    type: "container",
    bounds: { x: 0, y: 0, width: 375, height: 600 },
    styles: { backgroundColor: "#ffffff" },
  });
  const elements: Record<string, IRElement> = { root };
  for (const child of children) {
    elements[child.id] = { ...child, parentId: child.parentId ?? "root" };
  }
  return {
    version: "1.0.0",
    rootElementId: "root",
    elements,
    metadata: { title: "Test Doc", viewport: { width: 375, height: 600 } },
  };
}

const baseOptions: TransformOptions = {
  createdBy: "vitest",
  sourceType: "file",
  sourceIdentifier: "test.html",
  title: "Test Doc",
};

describe("VZITransformer.transform", () => {
  it("produces a complete TransformResult for a small IR", () => {
    const ir = makeIR([
      element({
        id: "title",
        type: "text",
        bounds: { x: 16, y: 16, width: 200, height: 24 },
        styles: { color: "#111827", fontSize: 20, backgroundColor: "#ffffff" },
        textContent: "Hello",
      }),
      element({
        id: "cta",
        type: "button",
        bounds: { x: 16, y: 60, width: 120, height: 44 },
        styles: { color: "#ffffff", backgroundColor: "#2563eb", fontSize: 16 },
        textContent: "Go",
      }),
    ]);

    const result = new VZITransformer(baseOptions).transform(ir);

    // Result shape: every documented field is present.
    expect(result).toEqual(
      expect.objectContaining({
        metadata: expect.any(Object),
        ir: expect.any(Object),
        tokens: expect.any(Object),
        annotations: expect.any(Array),
        source: expect.any(Object),
      }),
    );
    // Source provenance round-trips the options.
    expect(result.source.type).toBe("file");
    expect(result.source.identifier).toBe("test.html");
    expect(typeof result.source.capturedAt).toBe("number");
    // Token buckets are always arrays.
    expect(Array.isArray(result.tokens.colors)).toBe(true);
    expect(Array.isArray(result.tokens.fontSizes)).toBe(true);
    expect(Array.isArray(result.tokens.spacing)).toBe(true);
    // The three input elements survive into the normalized IR.
    expect(Object.keys(result.ir.elements)).toEqual(expect.arrayContaining(["root", "title", "cta"]));
  });

  it("extracts well-formed color/font tokens from repeated styles", () => {
    const ir = makeIR([
      element({
        id: "a",
        type: "text",
        styles: { color: "#2563eb", fontSize: 16, backgroundColor: "#2563eb" },
        textContent: "A",
      }),
      element({
        id: "b",
        type: "text",
        styles: { color: "#2563eb", fontSize: 16, backgroundColor: "#2563eb" },
        textContent: "B",
      }),
    ]);

    const result = transform(ir, { ...baseOptions, enableTokenExtraction: true });

    // A repeated color produces at least one token, and every token is shaped
    // as { value, frequency }.
    expect(result.tokens.colors.length).toBeGreaterThan(0);
    for (const token of result.tokens.colors) {
      expect(typeof token.value).toBe("string");
      expect(typeof token.frequency).toBe("number");
    }
    expect(result.tokens.colors.map((t) => t.value)).toContain("#2563eb");
    for (const token of result.tokens.fontSizes) {
      expect(typeof token.frequency).toBe("number");
    }
  });

  it("handles a root-only IR without throwing", () => {
    const result = transform(makeIR(), baseOptions);
    expect(Object.keys(result.ir.elements)).toContain("root");
    expect(result.annotations).toBeInstanceOf(Array);
  });

  it("matches the standalone transform() helper with the class", () => {
    const ir = makeIR([element({ id: "x", type: "text", textContent: "x" })]);
    const viaClass = new VZITransformer(baseOptions).transform(ir);
    const viaFn = transform(ir, baseOptions);
    expect(Object.keys(viaFn.ir.elements).sort()).toEqual(Object.keys(viaClass.ir.elements).sort());
  });
});

describe("buildVziContentFromTransformResult", () => {
  it("builds a VZI 2.0 content envelope whose header matches the IR", () => {
    const ir = makeIR([element({ id: "title", type: "text", styles: { fontSize: 18 }, textContent: "Hi" })]);
    const result = transform(ir, baseOptions);
    const content = buildVziContentFromTransformResult(result);

    // VZI 2.0 magic ("VZi2") and version.
    expect(content.header.magic).toBe(0x565a6932);
    expect(content.header.version).toBe(0x0002);
    // elementCount mirrors the normalized IR; elements is a Map of the same size.
    const irElementCount = Object.keys(result.ir.elements).length;
    expect(content.header.elementCount).toBe(irElementCount);
    expect(content.elements).toBeInstanceOf(Map);
    expect(content.elements.size).toBe(irElementCount);
    // Tokens/annotations flow straight through from the transform result.
    expect(content.colorTokens).toBe(result.tokens.colors);
    expect(content.fontTokens).toBe(result.tokens.fontSizes);
    expect(content.annotations).toBe(result.annotations);
  });
});
