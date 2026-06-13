import { access, mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FormaError,
  type StagedImageMeta,
  STAGING_TTL_MS,
  putStagedImage,
  resolveFormaImageRef,
} from "@xenonbyte/forma-core";

// ---------------------------------------------------------------------------
// SPEC-BEHAVIOR-001 / SPEC-BEHAVIOR-004 — image staging area
//
// Covers:
//   put   — files written on disk, meta shape, returned ref/path
//   resolve roundtrip — bytes identical to what was put
//   unknown id → MEDIA_IMAGE_NOT_FOUND
//   malformed ref (missing scheme) → MEDIA_IMAGE_NOT_FOUND
//   traversal attempt → MEDIA_IMAGE_NOT_FOUND
//   brand/ prefix → MEDIA_IMAGE_NOT_FOUND with brand_note detail
//   TTL sweep — expired pairs deleted, fresh entries kept
// ---------------------------------------------------------------------------

const PRODUCT_ID = "P-7e5701";
const SAMPLE_META: StagedImageMeta = {
  purpose: "page-hero",
  prompt: "A scenic mountain landscape at dawn",
  model: "doubao-seedream-5-0-260128",
  width: 2048,
  height: 1024,
};
const SAMPLE_BYTES = Buffer.from("fake-png-data-for-tests");

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "forma-image-staging-"));
});

// ---------------------------------------------------------------------------
// put — files on disk + meta shape + returned ref/path
// ---------------------------------------------------------------------------

describe("putStagedImage — files on disk", () => {
  it("writes a .png and .json pair under data/<productId>/image-staging/", async () => {
    const result = await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);

    const stagingDir = join(home, "data", PRODUCT_ID, "image-staging");
    const entries = await readdir(stagingDir);
    expect(entries).toContain(`${result.id}.png`);
    expect(entries).toContain(`${result.id}.json`);
  });

  it("returns a StagedImage with the correct ref format", async () => {
    const result = await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);
    expect(result.ref).toBe(`forma-image://${result.id}`);
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("returns a path pointing to the actual .png file", async () => {
    const result = await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);
    const expected = join(home, "data", PRODUCT_ID, "image-staging", `${result.id}.png`);
    expect(result.path).toBe(expected);
  });

  it("stores all meta fields plus created_at in the JSON sidecar", async () => {
    const result = await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);
    const jPath = join(home, "data", PRODUCT_ID, "image-staging", `${result.id}.json`);

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(jPath, "utf8");
    const parsed = JSON.parse(raw);

    expect(parsed.purpose).toBe(SAMPLE_META.purpose);
    expect(parsed.prompt).toBe(SAMPLE_META.prompt);
    expect(parsed.model).toBe(SAMPLE_META.model);
    expect(parsed.width).toBe(SAMPLE_META.width);
    expect(parsed.height).toBe(SAMPLE_META.height);
    expect(typeof parsed.created_at).toBe("string");
    // created_at must parse as a valid ISO date
    expect(Number.isFinite(Date.parse(parsed.created_at))).toBe(true);
  });

  it("each call produces a unique id", async () => {
    const a = await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);
    const b = await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// resolve roundtrip — bytes equal
// ---------------------------------------------------------------------------

describe("resolveFormaImageRef — roundtrip", () => {
  it("returns bytes identical to what was put", async () => {
    const result = await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);
    const resolved = await resolveFormaImageRef(home, PRODUCT_ID, result.ref);
    expect(resolved).toEqual(SAMPLE_BYTES);
  });

  it("returns a Buffer instance", async () => {
    const result = await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);
    const resolved = await resolveFormaImageRef(home, PRODUCT_ID, result.ref);
    expect(Buffer.isBuffer(resolved)).toBe(true);
  });

  it("does not delete the source file after resolve (consume by copy, TTL guards deletion)", async () => {
    const result = await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);
    await resolveFormaImageRef(home, PRODUCT_ID, result.ref);
    // Still resolvable on second call
    const second = await resolveFormaImageRef(home, PRODUCT_ID, result.ref);
    expect(second).toEqual(SAMPLE_BYTES);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("resolveFormaImageRef — unknown id", () => {
  it("throws MEDIA_IMAGE_NOT_FOUND for an unknown UUID", async () => {
    const fakeRef = "forma-image://00000000-0000-0000-0000-000000000000";
    await expect(resolveFormaImageRef(home, PRODUCT_ID, fakeRef)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });
});

describe("resolveFormaImageRef — malformed ref", () => {
  it("throws MEDIA_IMAGE_NOT_FOUND when the scheme prefix is missing", async () => {
    await expect(resolveFormaImageRef(home, PRODUCT_ID, "just-a-uuid")).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });

  it("throws MEDIA_IMAGE_NOT_FOUND for an empty string", async () => {
    await expect(resolveFormaImageRef(home, PRODUCT_ID, "")).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });

  it("throws MEDIA_IMAGE_NOT_FOUND for a random URL with a different scheme", async () => {
    await expect(resolveFormaImageRef(home, PRODUCT_ID, "https://example.com/image.png")).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });
});

describe("resolveFormaImageRef — rejects non-UUID tails before path construction", () => {
  it("rejects a dot-dot traversal tail (../../etc/passwd) with reason invalid_ref", async () => {
    const traversalRef = "forma-image://../../etc/passwd";
    let caught: FormaError | undefined;
    try {
      await resolveFormaImageRef(home, PRODUCT_ID, traversalRef);
    } catch (err) {
      if (err instanceof FormaError) caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught?.code).toBe("MEDIA_IMAGE_NOT_FOUND");
    expect(caught?.details.reason).toBe("invalid_ref");
  });

  it("rejects an absolute-path injection tail (/etc/passwd) with reason invalid_ref", async () => {
    // After stripping the scheme "forma-image://", the tail is "/etc/passwd"
    const absoluteRef = `forma-image:///etc/passwd`;
    let caught: FormaError | undefined;
    try {
      await resolveFormaImageRef(home, PRODUCT_ID, absoluteRef);
    } catch (err) {
      if (err instanceof FormaError) caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught?.code).toBe("MEDIA_IMAGE_NOT_FOUND");
    expect(caught?.details.reason).toBe("invalid_ref");
  });
});

describe("resolveFormaImageRef — brand/ prefix", () => {
  it("throws MEDIA_IMAGE_NOT_FOUND for a brand/ ref", async () => {
    const brandRef = "forma-image://brand/logo.png";
    await expect(resolveFormaImageRef(home, PRODUCT_ID, brandRef)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });

  it("includes a brand_note in the error details", async () => {
    const brandRef = "forma-image://brand/logo.png";
    let caught: FormaError | undefined;
    try {
      await resolveFormaImageRef(home, PRODUCT_ID, brandRef);
    } catch (err) {
      if (err instanceof FormaError) caught = err;
    }
    expect(caught).toBeDefined();
    expect(typeof caught?.details.brand_note).toBe("string");
    expect((caught?.details.brand_note as string).length).toBeGreaterThan(0);
  });

  it("throws MEDIA_IMAGE_NOT_FOUND for bare 'brand' (no slash)", async () => {
    const brandRef = "forma-image://brand";
    await expect(resolveFormaImageRef(home, PRODUCT_ID, brandRef)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });
});

// ---------------------------------------------------------------------------
// Finding 3a — putStagedImage must validate productId before joining a path.
//
// productId is joined into data/<productId>/image-staging. The security
// boundary is PATH SAFETY, not product-id SHAPE: staging only needs a safe
// single-segment directory name. A path-unsafe id (traversal, separators,
// absolute, NUL, control chars, over-length) must be rejected before any
// directory is created, so nothing escapes the staging tree. A path-safe
// non-product segment (e.g. the "media-config-test" smoke-test sentinel) is
// allowed — product existence is the caller's concern, not staging's.
// ---------------------------------------------------------------------------

describe("putStagedImage — productId validation (path-traversal guard)", () => {
  // All of these are PATH-UNSAFE: they would let the staged dir escape the
  // per-product tree (or carry a NUL/control char into a filesystem path).
  const BAD_IDS: Array<[string, string]> = [
    ["dot-dot traversal", "../../evil"],
    ["bare dot-dot", ".."],
    ["bare dot", "."],
    ["forward separator", "a/b"],
    ["backslash separator", "a\\b"],
    ["empty string", ""],
    ["absolute path", "/etc/passwd"],
    ["windows drive", "C:\\windows"],
    ["UNC path", "\\\\server\\share"],
    ["NUL byte", "P-abc1\x002"],
    ["control char (tab)", "P-abc\t12"],
    ["over-length", `P-${"a".repeat(200)}`],
  ];

  for (const [label, bad] of BAD_IDS) {
    it(`rejects ${label} (${JSON.stringify(bad)}) with MEDIA_INVALID_INPUT and creates nothing`, async () => {
      let caught: FormaError | undefined;
      try {
        await putStagedImage(home, bad, SAMPLE_BYTES, SAMPLE_META);
      } catch (err) {
        if (err instanceof FormaError) caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught?.code).toBe("MEDIA_INVALID_INPUT");

      // No staging directory escaped the data dir, and no traversal target was made.
      const dataDir = join(home, "data");
      await expect(access(join(dataDir, "evil"))).rejects.toBeDefined();
      // The bad id itself must not have produced a directory under data/.
      const dataEntries = await readdir(dataDir).catch(() => [] as string[]);
      expect(dataEntries).not.toContain("..");
    });
  }

  it("accepts a well-formed productId (regression)", async () => {
    const result = await putStagedImage(home, "P-abc123", SAMPLE_BYTES, SAMPLE_META);
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("accepts the path-safe non-product sentinel 'media-config-test' and stages correctly", async () => {
    // The POST /api/media/test smoke check stages a throwaway image under a
    // non-product sentinel id. It is path-safe (single segment, no separators),
    // so staging must accept it even though it is not the P-<6hex> shape.
    const sentinel = "media-config-test";
    const result = await putStagedImage(home, sentinel, SAMPLE_BYTES, SAMPLE_META);
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const stagingDir = join(home, "data", sentinel, "image-staging");
    const entries = await readdir(stagingDir);
    expect(entries).toContain(`${result.id}.png`);
    expect(entries).toContain(`${result.id}.json`);

    // Roundtrips through resolve under the same sentinel.
    const resolved = await resolveFormaImageRef(home, sentinel, result.ref);
    expect(resolved).toEqual(SAMPLE_BYTES);
  });

  it("accepts a path-safe id with dots/dashes/underscores (not P-shaped)", async () => {
    // Path-safety, not product-shape, is the boundary: a plain safe segment
    // like "my_bucket-1.0" has no separators/traversal and must be allowed.
    const result = await putStagedImage(home, "my_bucket-1.0", SAMPLE_BYTES, SAMPLE_META);
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// TTL sweep
// ---------------------------------------------------------------------------

describe("TTL sweep", () => {
  /**
   * Creates a fake staged entry (png + json sidecar) with a backdated
   * created_at (now - ageMs). We write it directly to disk rather than going
   * through putStagedImage so we can control created_at precisely.
   */
  async function plantExpiredEntry(dir: string, uuid: string, ageMs: number): Promise<void> {
    await mkdir(dir, { recursive: true });
    const createdAt = new Date(Date.now() - ageMs).toISOString();
    await writeFile(join(dir, `${uuid}.png`), Buffer.from("old-fake-png"));
    await writeFile(
      join(dir, `${uuid}.json`),
      JSON.stringify({ purpose: "old", prompt: "", model: "x", width: 1, height: 1, created_at: createdAt }),
    );
  }

  it("deletes an expired .png + .json pair (age > STAGING_TTL_MS)", async () => {
    const dir = join(home, "data", PRODUCT_ID, "image-staging");
    const expiredUUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    // Plant an entry older than TTL
    await plantExpiredEntry(dir, expiredUUID, STAGING_TTL_MS + 60_000);

    // Trigger a new put — sweep runs inside
    await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);

    const entries = await readdir(dir);
    expect(entries).not.toContain(`${expiredUUID}.png`);
    expect(entries).not.toContain(`${expiredUUID}.json`);
  });

  it("keeps a fresh entry (age < STAGING_TTL_MS) when sweeping", async () => {
    const dir = join(home, "data", PRODUCT_ID, "image-staging");
    const freshUUID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    // Plant an entry younger than TTL
    await plantExpiredEntry(dir, freshUUID, STAGING_TTL_MS - 60_000);

    // Trigger a new put
    await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);

    const entries = await readdir(dir);
    expect(entries).toContain(`${freshUUID}.png`);
    expect(entries).toContain(`${freshUUID}.json`);
  });

  it("keeps both expired AND fresh entries when only fresh is involved (mixed bag)", async () => {
    const dir = join(home, "data", PRODUCT_ID, "image-staging");
    const expiredUUID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const freshUUID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

    await plantExpiredEntry(dir, expiredUUID, STAGING_TTL_MS + 60_000);
    await plantExpiredEntry(dir, freshUUID, STAGING_TTL_MS - 60_000);

    const newEntry = await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);

    const entries = await readdir(dir);
    // Expired pair gone
    expect(entries).not.toContain(`${expiredUUID}.png`);
    expect(entries).not.toContain(`${expiredUUID}.json`);
    // Fresh pair kept
    expect(entries).toContain(`${freshUUID}.png`);
    expect(entries).toContain(`${freshUUID}.json`);
    // New entry present
    expect(entries).toContain(`${newEntry.id}.png`);
    expect(entries).toContain(`${newEntry.id}.json`);
  });

  it("sweeps an orphan .png (no .json) whose mtime is past TTL", async () => {
    const dir = join(home, "data", PRODUCT_ID, "image-staging");
    await mkdir(dir, { recursive: true });
    const orphanUUID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const orphanPng = join(dir, `${orphanUUID}.png`);

    // Write png but no json sidecar
    await writeFile(orphanPng, Buffer.from("orphan-png"));

    // Backdate mtime so the orphan is older than TTL
    const oldTime = new Date(Date.now() - (STAGING_TTL_MS + 60_000));
    await utimes(orphanPng, oldTime, oldTime);

    // Trigger sweep via put
    await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);

    const entries = await readdir(dir);
    expect(entries).not.toContain(`${orphanUUID}.png`);
  });

  it("keeps an orphan .png (no .json) whose mtime is within TTL", async () => {
    const dir = join(home, "data", PRODUCT_ID, "image-staging");
    await mkdir(dir, { recursive: true });
    const freshOrphanUUID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const freshOrphanPng = join(dir, `${freshOrphanUUID}.png`);

    // Write png but no json sidecar — mtime is current (within TTL)
    await writeFile(freshOrphanPng, Buffer.from("fresh-orphan-png"));

    // Trigger sweep via put
    await putStagedImage(home, PRODUCT_ID, SAMPLE_BYTES, SAMPLE_META);

    const entries = await readdir(dir);
    expect(entries).toContain(`${freshOrphanUUID}.png`);
  });

  it("STAGING_TTL_MS equals 24 hours in ms", () => {
    expect(STAGING_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
