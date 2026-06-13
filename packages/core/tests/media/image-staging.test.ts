import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
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

const PRODUCT_ID = "P-test01";
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

describe("resolveFormaImageRef — path traversal", () => {
  it("throws MEDIA_IMAGE_NOT_FOUND for a traversal attempt (../../etc/passwd style)", async () => {
    const traversalRef = "forma-image://../../etc/passwd";
    await expect(resolveFormaImageRef(home, PRODUCT_ID, traversalRef)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
  });

  it("throws MEDIA_IMAGE_NOT_FOUND for a traversal with absolute path injection", async () => {
    // After stripping the scheme, the tail would be an absolute path
    const absoluteRef = `forma-image:///etc/passwd`;
    await expect(resolveFormaImageRef(home, PRODUCT_ID, absoluteRef)).rejects.toSatisfy(
      (err: unknown) => err instanceof FormaError && err.code === "MEDIA_IMAGE_NOT_FOUND",
    );
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
