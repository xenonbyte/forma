import { describe, expect, it } from "vitest";
import type { IRElement } from "@vzi-core/types";
import { getVZIFileInfo, SpatialIndexBuilder, VZIEncoder, VZIDecoder, type VZIContent } from "../src/index.js";

function makeElement(id: string, x: number, y: number): IRElement {
  return {
    id,
    parentId: null,
    type: "container",
    bounds: { x, y, width: 10, height: 10 },
    styles: {},
  };
}

function makeContent(elements: Map<string, IRElement>): VZIContent {
  const spatialIndex = new SpatialIndexBuilder({
    maxDepth: 3,
    maxElementsPerNode: 1,
    minNodeSize: 1,
  }).build(elements);

  return {
    header: {
      magic: 0x565a6932,
      version: 0x0002,
      fileSize: BigInt(0),
      elementCount: elements.size,
      blockCount: 0,
      metadataOffset: BigInt(0),
      metadataLength: 0,
      blockIndexOffset: BigInt(0),
      blockIndexLength: 0,
      dataOffset: BigInt(0),
      checksum: new Uint8Array(32),
      reserved: new Uint8Array(168),
    },
    metadata: {
      name: "Spatial Regression",
      createdAt: "2026-06-02T00:00:00.000Z",
      modifiedAt: "2026-06-02T00:00:00.000Z",
      viewportWidth: 220,
      viewportHeight: 220,
      minReaderVersion: "2.0.0",
      features: [],
    },
    elements,
    sharedStyles: new Map(),
    spatialIndex,
    colorTokens: [],
    fontTokens: [],
    annotations: [],
    images: new Map(),
    layers: [],
    compatibility: {
      minReaderVersion: "2.0.0",
      formatVersion: "2.0.0",
      features: [],
    },
  };
}

function makeSplitSpatialContent(): VZIContent {
  return makeContent(
    new Map([
      ["top-left", makeElement("top-left", 0, 0)],
      ["top-right", makeElement("top-right", 200, 0)],
      ["bottom-left", makeElement("bottom-left", 0, 200)],
      ["bottom-right", makeElement("bottom-right", 200, 200)],
    ]),
  );
}

describe("VZI format regressions", () => {
  it("preserves spatial index rootBlockId and maxDepth through encode/decode", () => {
    const source = makeSplitSpatialContent();
    const encoded = new VZIEncoder().encode(source);
    const decoded = new VZIDecoder().decode(encoded).content;

    expect(decoded.spatialIndex.rootBlockId).toBe(source.spatialIndex.rootBlockId);
    expect(decoded.spatialIndex.maxDepth).toBe(source.spatialIndex.maxDepth);

    const hits = new SpatialIndexBuilder().query(decoded.spatialIndex, {
      x: 190,
      y: 190,
      width: 40,
      height: 40,
    });
    expect(hits).toContain("bottom-right");
  });

  it("reads blockIndexOffset and blockIndexLength from the VZI header when reporting file info", () => {
    const encoded = new VZIEncoder().encode(makeSplitSpatialContent());

    expect(getVZIFileInfo(encoded)).toMatchObject({
      version: "2.0",
      elementCount: 4,
      hasSpatialIndex: true,
    });
  });
});
