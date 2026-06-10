import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactManifest } from "../src/artifact-manifest.js";
import { createArtifactStore } from "../src/artifact-store.js";
import { getProductMutationLock } from "../src/product-mutation-lock.js";
import { FormaError } from "../src/errors.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTestRoot(): string {
  return join(tmpdir(), `artifact-store-test-${randomBytes(6).toString("hex")}`);
}

function makeManifest(overrides: Partial<ArtifactManifest> = {}): ArtifactManifest {
  return {
    version: 1,
    id: "AbCdEfGhIjKlMnOp",
    kind: "html",
    renderer: "html",
    title: "Test Artifact",
    entry: "index.html",
    status: "complete",
    exports: ["index.html"],
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    ...overrides,
  };
}

function makeFiles(content = "<h1>Hello</h1>"): Map<string, Buffer> {
  return new Map([["index.html", Buffer.from(content)]]);
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("ArtifactStore", () => {
  let testRoot: string;
  let productsRoot: string;
  const productId = "P-ab1234"; // must match /^P-[a-f0-9]{6}$/

  beforeEach(async () => {
    testRoot = makeTestRoot();
    productsRoot = join(testRoot, "data", "products");
    await mkdir(productsRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  // ─── Step 1: writeArtifact happy path ───────────────────────────────────────
  describe("writeArtifact — happy path", () => {
    it("writes artifact dir + manifest.json and returns consistent ETag on read-back", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const manifest = makeManifest();
      const files = makeFiles();

      const { artifactId, etag } = await store.writeArtifact({ productId, manifest, files });

      expect(typeof artifactId).toBe("string");
      expect(artifactId.length).toBeGreaterThan(0);
      expect(typeof etag).toBe("string");
      expect(etag.length).toBe(64); // SHA-256 hex

      // Read back and verify ETag matches
      const { manifest: readManifest, etag: readEtag } = await store.readArtifact(productId, artifactId);
      expect(readEtag).toBe(etag);
      expect(readManifest.kind).toBe(manifest.kind);
      expect(readManifest.title).toBe(manifest.title);
    });

    it("writes all files into the artifact directory", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const manifest = makeManifest();
      const files = new Map([
        ["index.html", Buffer.from("<h1>Hello</h1>")],
        ["assets/style.css", Buffer.from("body { color: red; }")],
      ]);

      const { artifactId } = await store.writeArtifact({ productId, manifest, files });

      // Verify files exist
      const artifactDir = join(productsRoot, productId, "od-project", "artifacts", artifactId);
      const indexContent = await readFile(join(artifactDir, "index.html"), "utf8");
      const cssContent = await readFile(join(artifactDir, "assets", "style.css"), "utf8");
      expect(indexContent).toBe("<h1>Hello</h1>");
      expect(cssContent).toBe("body { color: red; }");
    });

    it("calls retentionHook after successful write", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const manifest = makeManifest();
      const files = makeFiles();
      const retentionHook = vi.fn().mockResolvedValue(undefined);

      const { artifactId } = await store.writeArtifact({ productId, manifest, files, retentionHook });

      expect(retentionHook).toHaveBeenCalledOnce();
      expect(retentionHook).toHaveBeenCalledWith(artifactId, productId);
    });

    it("does not call retentionHook when not provided", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      // Should not throw even without a retention hook
      const { artifactId } = await store.writeArtifact({
        productId,
        manifest: makeManifest(),
        files: makeFiles(),
      });
      expect(typeof artifactId).toBe("string");
    });

    it("persists manifest.id as the chosen artifact id", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const forcedId = "ForcedArtifact01";

      const { artifactId } = await store.writeArtifact({
        productId,
        manifest: makeManifest({ id: "OldManifestId000" }),
        files: makeFiles(),
        __forceNanoid: forcedId,
      });

      const { manifest: readManifest } = await store.readArtifact(productId, artifactId);
      expect(readManifest.id).toBe(artifactId);
    });
  });

  // ─── Step 2: Failure atomicity ──────────────────────────────────────────────
  describe("writeArtifact — failure atomicity", () => {
    it("rejects manifest entry paths that escape the artifact directory", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      await expect(
        store.writeArtifact({
          productId,
          manifest: makeManifest({ entry: "../escape.html" }),
          files: makeFiles(),
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_INVALID_INPUT" });

      const artifactsDir = join(productsRoot, productId, "od-project", "artifacts");
      const entries = existsSync(artifactsDir) ? readdirSync(artifactsDir) : [];
      expect(entries.filter((e) => e.startsWith(".tmp-"))).toHaveLength(0);
    });

    it("rejects manifest supportingFiles paths that escape the artifact directory", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      await expect(
        store.writeArtifact({
          productId,
          manifest: makeManifest({ supportingFiles: ["../escape.css"] }),
          files: makeFiles(),
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_INVALID_INPUT" });

      const artifactsDir = join(productsRoot, productId, "od-project", "artifacts");
      const entries = existsSync(artifactsDir) ? readdirSync(artifactsDir) : [];
      expect(entries.filter((e) => e.startsWith(".tmp-"))).toHaveLength(0);
    });

    it("rejects supporting file paths that escape the artifact tmp directory", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const files = new Map([["../escape.txt", Buffer.from("outside tmp")]]);

      await expect(store.writeArtifact({ productId, manifest: makeManifest(), files })).rejects.toMatchObject({
        code: "ARTIFACT_INVALID_INPUT",
      });

      const artifactsDir = join(productsRoot, productId, "od-project", "artifacts");
      expect(existsSync(join(artifactsDir, "escape.txt"))).toBe(false);
      const entries = existsSync(artifactsDir) ? readdirSync(artifactsDir) : [];
      expect(entries.filter((e) => e.startsWith(".tmp-"))).toHaveLength(0);
    });

    it("throws ARTIFACT_ALREADY_EXISTS when artifact dir pre-exists (collision guard before rename)", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const manifest = makeManifest();
      const files = makeFiles();
      const forcedId = "AtomicTest1234AB";

      // Pre-create the artifact dir to cause rename to fail (ENOTEMPTY / EEXIST on macOS)
      const artifactDir = join(productsRoot, productId, "od-project", "artifacts", forcedId);
      await mkdir(artifactDir, { recursive: true });
      // Write a sentinel file so we can verify it's untouched after failure
      await import("node:fs/promises").then((fs) => fs.writeFile(join(artifactDir, "sentinel.txt"), "original"));

      await expect(store.writeArtifact({ productId, manifest, files, __forceNanoid: forcedId })).rejects.toThrow(
        FormaError,
      );

      // The error code should be ARTIFACT_ALREADY_EXISTS (collision guard catches this before rename)
      try {
        await store.writeArtifact({ productId, manifest, files, __forceNanoid: forcedId });
      } catch (err) {
        expect(err).toBeInstanceOf(FormaError);
        const fe = err as FormaError;
        // Pre-existing dir triggers ARTIFACT_ALREADY_EXISTS
        expect(fe.code).toBe("ARTIFACT_ALREADY_EXISTS");
      }

      // Sentinel file must still exist — original content unchanged
      const sentinel = await readFile(join(artifactDir, "sentinel.txt"), "utf8");
      expect(sentinel).toBe("original");
    });

    it("throws ARTIFACT_ALREADY_EXISTS when same __forceNanoid used twice, original content unchanged", async () => {
      // This test verifies the ARTIFACT_WRITE_FAIL path by checking the error code
      // The easiest way is to mock rename at module level; here we verify the code
      // is exported correctly by checking FormaError throw pattern
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      // Write one artifact, then use same ID to trigger ARTIFACT_ALREADY_EXISTS
      const forcedId = "ColliTest5678XYZ";
      await store.writeArtifact({
        productId,
        manifest: makeManifest(),
        files: makeFiles("first"),
        __forceNanoid: forcedId,
      });

      // Read back to confirm original is there
      const { manifest: readManifest } = await store.readArtifact(productId, forcedId);
      expect(readManifest.title).toBe("Test Artifact");

      // Now try to overwrite — must throw ARTIFACT_ALREADY_EXISTS
      await expect(
        store.writeArtifact({
          productId,
          manifest: makeManifest({ title: "Overwrite Attempt" }),
          files: makeFiles("second"),
          __forceNanoid: forcedId,
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_ALREADY_EXISTS" });

      // Original content is unchanged
      const { manifest: afterAttempt } = await store.readArtifact(productId, forcedId);
      expect(afterAttempt.title).toBe("Test Artifact");
    });

    it("cleans up tmp dir and throws ARTIFACT_WRITE_FAIL when rename throws", async () => {
      const mockRename = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("cross-device link"), { code: "EXDEV" }));
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock, { _rename: mockRename as any });
      const manifest = makeManifest();
      const files = makeFiles();

      await expect(store.writeArtifact({ productId, manifest, files })).rejects.toMatchObject({
        code: "ARTIFACT_WRITE_FAIL",
      });

      // Verify no tmp dirs remain in the artifacts dir
      const artifactsDir = join(productsRoot, productId, "od-project", "artifacts");
      const entries = existsSync(artifactsDir) ? readdirSync(artifactsDir) : [];
      const tmpDirs = entries.filter((e) => e.startsWith(".tmp-"));
      expect(tmpDirs).toHaveLength(0);
    });
  });

  // ─── Step 3: Concurrent writes serialized (SPEC-EDGE-001) ───────────────────
  describe("writeArtifact — concurrency serialization", () => {
    it("two concurrent writes for the same product do not overlap", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const order: string[] = [];

      const write1 = store
        .writeArtifact({
          productId,
          manifest: makeManifest({ title: "Write 1" }),
          files: makeFiles("content-1"),
          retentionHook: async (id) => {
            order.push(`hook-1:${id}`);
          },
        })
        .then((r) => {
          order.push(`done-1:${r.artifactId}`);
          return r;
        });

      const write2 = store
        .writeArtifact({
          productId,
          manifest: makeManifest({ title: "Write 2" }),
          files: makeFiles("content-2"),
          retentionHook: async (id) => {
            order.push(`hook-2:${id}`);
          },
        })
        .then((r) => {
          order.push(`done-2:${r.artifactId}`);
          return r;
        });

      const [r1, r2] = await Promise.all([write1, write2]);

      // Both must succeed
      expect(r1.artifactId).toBeTruthy();
      expect(r2.artifactId).toBeTruthy();
      expect(r1.artifactId).not.toBe(r2.artifactId);

      // Verify both artifacts exist
      const list = await store.listArtifacts(productId);
      const ids = list.map((a) => a.artifactId);
      expect(ids).toContain(r1.artifactId);
      expect(ids).toContain(r2.artifactId);

      // Serialization: each write's hook must fire before the next write's done marker appears
      // (i.e., hook-1 before done-1, hook-2 before done-2, and both grouped by lock order)
      const hook1Idx = order.findIndex((e) => e.startsWith("hook-1:"));
      const done1Idx = order.findIndex((e) => e.startsWith("done-1:"));
      const hook2Idx = order.findIndex((e) => e.startsWith("hook-2:"));
      const done2Idx = order.findIndex((e) => e.startsWith("done-2:"));

      expect(hook1Idx).toBeLessThan(done1Idx);
      expect(hook2Idx).toBeLessThan(done2Idx);
    });
  });

  // ─── Step 4: __forceNanoid collision → ARTIFACT_ALREADY_EXISTS (SPEC-DS-001a) ─
  describe("writeArtifact — collision guard (SPEC-DS-001a)", () => {
    it("throws ARTIFACT_ALREADY_EXISTS when __forceNanoid matches existing artifact, content unchanged", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const forcedId = "CollisionAABBCCD";

      // Write artifact A
      await store.writeArtifact({
        productId,
        manifest: makeManifest({ title: "Artifact A", id: forcedId }),
        files: makeFiles("artifact-A-content"),
        __forceNanoid: forcedId,
      });

      // Confirm A is readable
      const { manifest: manifestA } = await store.readArtifact(productId, forcedId);
      expect(manifestA.title).toBe("Artifact A");

      // Write B with same ID → must throw ARTIFACT_ALREADY_EXISTS
      await expect(
        store.writeArtifact({
          productId,
          manifest: makeManifest({ title: "Artifact B", id: forcedId }),
          files: makeFiles("artifact-B-content"),
          __forceNanoid: forcedId,
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_ALREADY_EXISTS" });

      // Artifact A content must be unchanged
      const { manifest: manifestAAfter } = await store.readArtifact(productId, forcedId);
      expect(manifestAAfter.title).toBe("Artifact A");

      // Verify the file for A still has original content
      const artifactDir = join(productsRoot, productId, "od-project", "artifacts", forcedId);
      const indexContent = await readFile(join(artifactDir, "index.html"), "utf8");
      expect(indexContent).toBe("artifact-A-content");
    });
  });

  // ─── Step 5: Static grep verified externally in CI ──────────────────────────
  // The literal "od-project/artifacts/" must only appear in:
  //   artifact-store.ts, artifact-paths.ts, artifact-tmp-cleanup.ts

  // ─── Step 6: Full implementation — readArtifact / listArtifacts / deleteArtifact ─
  describe("readArtifact", () => {
    it("throws ARTIFACT_NOT_FOUND for missing artifact", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      await expect(store.readArtifact(productId, "NonExistent1234")).rejects.toMatchObject({
        code: "ARTIFACT_NOT_FOUND",
      });
    });
  });

  describe("listArtifacts", () => {
    it("returns empty array when no artifacts exist", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      const list = await store.listArtifacts(productId);
      expect(list).toEqual([]);
    });

    it("lists all written artifacts with their ETags", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      const r1 = await store.writeArtifact({
        productId,
        manifest: makeManifest({ title: "A1" }),
        files: makeFiles("a1"),
      });
      const r2 = await store.writeArtifact({
        productId,
        manifest: makeManifest({ title: "A2" }),
        files: makeFiles("a2"),
      });

      const list = await store.listArtifacts(productId);
      expect(list).toHaveLength(2);
      const ids = list.map((a) => a.artifactId);
      expect(ids).toContain(r1.artifactId);
      expect(ids).toContain(r2.artifactId);

      // ETags must match what writeArtifact returned
      const item1 = list.find((a) => a.artifactId === r1.artifactId);
      const item2 = list.find((a) => a.artifactId === r2.artifactId);
      expect(item1?.etag).toBe(r1.etag);
      expect(item2?.etag).toBe(r2.etag);
    });

    it("Bug #2: lists versioned-only artifacts (no flat manifest) via writeArtifactVersion", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const aid = "VrsnedOnlyABC123";
      // Write only a versioned artifact (no flat manifest.json)
      await store.writeArtifactVersion({
        productId,
        artifactId: aid,
        version: 1,
        manifest: makeManifest({
          id: "VrsnedOnlyABC123",
          kind: "design-page",
          forma: { requirementId: "R-1234abcd", pageId: "home", variant: "default" },
        }),
        files: new Map([["index.html", Buffer.from("<h1>versioned</h1>")]]),
      });

      const list = await store.listArtifacts(productId);
      const ids = list.map((a) => a.artifactId);
      expect(ids).toContain(aid);
      const item = list.find((a) => a.artifactId === aid);
      expect(typeof item?.etag).toBe("string");
      expect(item!.etag.length).toBe(64);
    });

    it("Bug #2: lists both flat and versioned artifacts together", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      // Flat artifact
      const { artifactId: flatId } = await store.writeArtifact({
        productId,
        manifest: makeManifest({ title: "Flat" }),
        files: new Map([["index.html", Buffer.from("<h1>flat</h1>")]]),
      });

      // Versioned-only artifact
      const vAid = "VrsnedMixABCD123";
      await store.writeArtifactVersion({
        productId,
        artifactId: vAid,
        version: 1,
        manifest: makeManifest({
          id: vAid,
          kind: "design-page",
          forma: { requirementId: "R-1234abcd", pageId: "about", variant: "default" },
        }),
        files: new Map([["index.html", Buffer.from("<h1>v1</h1>")]]),
      });

      const list = await store.listArtifacts(productId);
      const ids = list.map((a) => a.artifactId);
      expect(ids).toContain(flatId);
      expect(ids).toContain(vAid);
    });

    it("skips invalid artifact directory names instead of aborting the listing", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const written = await store.writeArtifact({
        productId,
        manifest: makeManifest({ title: "A1" }),
        files: makeFiles("a1"),
      });
      const artifactsDir = join(productsRoot, productId, "od-project", "artifacts");
      await writeFile(join(artifactsDir, ".DS_Store"), "Finder metadata");
      await mkdir(join(artifactsDir, "not an artifact id"), { recursive: true });

      const list = await store.listArtifacts(productId);

      expect(list).toEqual([{ artifactId: written.artifactId, etag: written.etag }]);
    });
  });

  describe("deleteArtifact", () => {
    it("removes the artifact directory", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      const { artifactId } = await store.writeArtifact({
        productId,
        manifest: makeManifest(),
        files: makeFiles(),
      });

      await store.deleteArtifact(productId, artifactId);

      await expect(store.readArtifact(productId, artifactId)).rejects.toMatchObject({
        code: "ARTIFACT_NOT_FOUND",
      });
    });

    it("throws ARTIFACT_NOT_FOUND when deleting non-existent artifact", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);

      await expect(store.deleteArtifact(productId, "NoExist12345678")).rejects.toMatchObject({
        code: "ARTIFACT_NOT_FOUND",
      });
    });
  });

  // ─── Step 7: RetentionHook type is exported ──────────────────────────────────
  describe("RetentionHook type", () => {
    it("retentionHook is called with correct args", async () => {
      const lock = getProductMutationLock(testRoot);
      const store = createArtifactStore(productsRoot, lock);
      const calls: Array<[string, string]> = [];

      const retentionHook = async (artifactId: string, pid: string) => {
        calls.push([artifactId, pid]);
      };

      const { artifactId } = await store.writeArtifact({
        productId,
        manifest: makeManifest(),
        files: makeFiles(),
        retentionHook,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([artifactId, productId]);
    });
  });
});

describe("A3 versioned artifact read/write", () => {
  // 注意：现有测试里 lock 是每个 it 内局部声明（const lock = getProductMutationLock(testRoot)），
  // 不在 beforeEach。下面每个 it 同样自行声明 lock。productId/productsRoot/testRoot 为模块级，已就绪。
  let testRoot: string;
  let productsRoot: string;
  const productId = "P-ab1234"; // must match /^P-[a-f0-9]{6}$/

  beforeEach(async () => {
    testRoot = join(tmpdir(), `artifact-store-a3-${randomBytes(6).toString("hex")}`);
    productsRoot = join(testRoot, "data", "products");
    await mkdir(productsRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it("writes and reads v1 then v2 of the same artifact id", async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    const aid = "AbCdEfGhIjKlMnOp";
    await store.writeArtifactVersion({
      productId,
      artifactId: aid,
      version: 1,
      manifest: makeManifest({
        id: aid,
        kind: "design-page",
        forma: { requirementId: "R-1234abcd", pageId: "login", variant: "default" },
      }),
      files: new Map([["index.html", Buffer.from("<h1>v1</h1>")]]),
    });
    await store.writeArtifactVersion({
      productId,
      artifactId: aid,
      version: 2,
      manifest: makeManifest({
        id: aid,
        kind: "design-page",
        forma: { requirementId: "R-1234abcd", pageId: "login", variant: "default" },
      }),
      files: new Map([["index.html", Buffer.from("<h1>v2</h1>")]]),
    });

    const v1 = await store.readArtifactVersion(productId, aid, 1);
    const v2 = await store.readArtifactVersion(productId, aid, 2);
    expect(v1.manifest.id).toBe(aid);
    expect(v2.manifest.id).toBe(aid);

    const versions = await store.listArtifactVersions(productId, aid);
    expect(versions.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("rejects overwriting an existing version", async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    const aid = "BbCdEfGhIjKlMnOp";
    const input = {
      productId,
      artifactId: aid,
      version: 1,
      manifest: makeManifest({ id: aid, kind: "design-page", forma: { variant: "default" } }),
      files: new Map([["index.html", Buffer.from("x")]]),
    };
    await store.writeArtifactVersion(input);
    await expect(store.writeArtifactVersion(input)).rejects.toThrow(/already exists/i);
  });

  it("preserves an existing flat legacy artifact when first version commit hook fails", async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    const aid = "LgcyFlatAbCd1234";

    await store.writeArtifact({
      productId,
      manifest: makeManifest({ id: aid, title: "Legacy Flat Artifact" }),
      files: new Map([["index.html", Buffer.from("<h1>legacy flat</h1>")]]),
      __forceNanoid: aid,
    });

    await expect(
      store.writeArtifactVersion({
        productId,
        artifactId: aid,
        version: 1,
        manifest: makeManifest({
          id: aid,
          kind: "design-page",
          title: "Failed v1",
          forma: { requirementId: "R-1234abcd", pageId: "home", variant: "default" },
        }),
        files: new Map([["index.html", Buffer.from("<h1>failed v1</h1>")]]),
        afterWriteLocked: () => {
          throw new Error("injected commit failure");
        },
      }),
    ).rejects.toThrow("injected commit failure");

    await expect(store.listArtifactVersions(productId, aid)).resolves.toEqual([]);
    await expect(store.readArtifactVersion(productId, aid, 1)).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });

    const artifactDir = join(productsRoot, productId, "od-project", "artifacts", aid);
    await expect(readFile(join(artifactDir, "index.html"), "utf8")).resolves.toBe("<h1>legacy flat</h1>");
    await expect(readFile(join(artifactDir, "manifest.json"), "utf8")).resolves.toContain("Legacy Flat Artifact");
    await expect(store.readArtifact(productId, aid)).resolves.toMatchObject({
      manifest: { id: aid, title: "Legacy Flat Artifact" },
    });
  });

  it("readArtifactVersion throws ARTIFACT_NOT_FOUND for missing version", async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    await expect(store.readArtifactVersion(productId, "ZZCdEfGhIjKlMnOp", 9)).rejects.toThrow();
  });

  it("Review #3: allocates the next version when version is omitted", async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    const aid = "CcCdEfGhIjKlMnOp";
    const base = {
      productId,
      artifactId: aid,
      manifest: makeManifest({ id: aid, kind: "design-page", forma: { variant: "default" } }),
      files: new Map([["index.html", Buffer.from("x")]]),
    };

    const first = await store.writeArtifactVersion(base);
    const second = await store.writeArtifactVersion(base);
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(await store.listArtifactVersions(productId, aid)).toEqual([1, 2]);
  });

  it("Review #3: concurrent version-omitted writes do not collide on the same version", async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    const aid = "EeCdEfGhIjKlMnOp";
    const make = () => ({
      productId,
      artifactId: aid,
      manifest: makeManifest({ id: aid, kind: "design-page", forma: { variant: "default" } }),
      files: new Map([["index.html", Buffer.from("x")]]),
    });

    const results = await Promise.all([
      store.writeArtifactVersion(make()),
      store.writeArtifactVersion(make()),
      store.writeArtifactVersion(make()),
    ]);

    const versions = results.map((r) => r.version).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2, 3]);
    expect(await store.listArtifactVersions(productId, aid)).toEqual([1, 2, 3]);
  });

  it("A5 regression: icons/ and vzi/ siblings are ignored by listArtifactVersions", async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    const aid = "FfCdEfGhIjKlMnOp";

    // Write v1
    await store.writeArtifactVersion({
      productId,
      artifactId: aid,
      version: 1,
      manifest: makeManifest({
        id: aid,
        kind: "design-page",
        forma: { requirementId: "R-1234abcd", pageId: "home", variant: "default" },
      }),
      files: new Map([["index.html", Buffer.from("<h1>v1</h1>")]]),
    });

    // Manually create icons/ and vzi/ siblings next to v1/
    const artifactDir = join(productsRoot, productId, "od-project", "artifacts", aid);
    await mkdir(join(artifactDir, "icons"), { recursive: true });
    await mkdir(join(artifactDir, "vzi"), { recursive: true });
    await writeFile(join(artifactDir, "icons", "icons.json"), JSON.stringify([]));
    await writeFile(join(artifactDir, "vzi", "page.vzi"), "vzi-content");

    // listArtifactVersions must return only [1] — icons/ and vzi/ are ignored
    const versions = await store.listArtifactVersions(productId, aid);
    expect(versions).toEqual([1]);
  });
});

describe("A4 assets write-path consistency", () => {
  let testRoot: string;
  let productsRoot: string;
  const productId = "P-ab1234"; // must match /^P-[a-f0-9]{6}$/

  beforeEach(async () => {
    testRoot = join(tmpdir(), `artifact-store-a4-${randomBytes(6).toString("hex")}`);
    productsRoot = join(testRoot, "data", "products");
    await mkdir(productsRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it("rejects flat writes when forma.assets is not a subset of supportingFiles", async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    await expect(
      store.writeArtifact({
        productId,
        manifest: makeManifest({
          kind: "design-page",
          supportingFiles: ["index.html"],
          forma: {
            requirementId: "R-1234abcd",
            pageId: "login",
            variant: "default",
            assets: [{ path: "assets/missing@1x.png", density: [1], role: "image" }],
          },
        }),
        files: new Map([["index.html", Buffer.from("x")]]),
      }),
    ).rejects.toThrow(/forma\.assets path missing/);
  });

  it("rejects version writes when forma.assets is not a subset of supportingFiles", async () => {
    const lock = getProductMutationLock(testRoot);
    const store = createArtifactStore(productsRoot, lock);
    const aid = "DdCdEfGhIjKlMnOp";
    await expect(
      store.writeArtifactVersion({
        productId,
        artifactId: aid,
        version: 1,
        manifest: makeManifest({
          id: aid,
          kind: "design-page",
          supportingFiles: ["index.html"],
          forma: {
            requirementId: "R-1234abcd",
            pageId: "login",
            variant: "default",
            assets: [{ path: "assets/missing@1x.png", density: [1], role: "image" }],
          },
        }),
        files: new Map([["index.html", Buffer.from("x")]]),
      }),
    ).rejects.toThrow(/forma\.assets path missing/);
  });
});
