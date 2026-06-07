import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ids.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ids.js")>();
  return { ...actual, createId: vi.fn(actual.createId) };
});
vi.mock("../src/yaml.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/yaml.js")>();
  return { ...actual, writeYamlAtomic: vi.fn(actual.writeYamlAtomic) };
});

import { createId } from "../src/ids.js";
import { writeYamlAtomic } from "../src/yaml.js";
import { ProductService } from "../src/product.js";

const homes: string[] = [];

afterEach(async () => {
  vi.mocked(createId).mockReset();
  const actualIds = await vi.importActual<typeof import("../src/ids.js")>("../src/ids.js");
  vi.mocked(createId).mockImplementation(actualIds.createId);
  const actualYaml = await vi.importActual<typeof import("../src/yaml.js")>("../src/yaml.js");
  vi.mocked(writeYamlAtomic).mockReset();
  vi.mocked(writeYamlAtomic).mockImplementation(actualYaml.writeYamlAtomic);
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function testHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "forma-product-collision-"));
  homes.push(home);
  return home;
}

describe("createProduct collision safety (R2)", () => {
  it("retries on an indexed-id collision and leaves the original product untouched", async () => {
    const home = await testHome();
    const products = new ProductService({ home });
    const first = await products.createProduct({ name: "First", description: "d1" });

    const actualIds = await vi.importActual<typeof import("../src/ids.js")>("../src/ids.js");
    vi.mocked(createId)
      .mockReturnValueOnce(first.id) // collide once
      .mockImplementation(actualIds.createId);

    const before = await readFile(join(home, "data", first.id, "product.yaml"), "utf8");
    const second = await products.createProduct({ name: "Second", description: "d2" });

    expect(second.id).not.toBe(first.id);
    const after = await readFile(join(home, "data", first.id, "product.yaml"), "utf8");
    expect(after).toBe(before);
  });

  it("treats a non-indexed orphan product dir as occupied and never writes into it", async () => {
    const home = await testHome();
    const products = new ProductService({ home });
    const orphanId = "P-0ffffe";
    await mkdir(join(home, "data", orphanId), { recursive: true });
    await writeFile(join(home, "data", orphanId, "stray.txt"), "do not touch", "utf8");

    const actualIds = await vi.importActual<typeof import("../src/ids.js")>("../src/ids.js");
    vi.mocked(createId)
      .mockReturnValueOnce(orphanId)
      .mockImplementation(actualIds.createId);

    const created = await products.createProduct({ name: "P", description: "d" });

    expect(created.id).not.toBe(orphanId);
    await expect(readFile(join(home, "data", orphanId, "stray.txt"), "utf8")).resolves.toBe("do not touch");
    await expect(access(join(home, "data", orphanId, "product.yaml"))).rejects.toThrow();
  });

  it("throws PRODUCT_ID_ALLOCATION_FAILED after exhausting retries", async () => {
    const home = await testHome();
    const products = new ProductService({ home });
    const first = await products.createProduct({ name: "First", description: "d1" });

    vi.mocked(createId).mockReturnValue(first.id); // collide forever

    await expect(products.createProduct({ name: "Second", description: "d2" })).rejects.toMatchObject({
      code: "PRODUCT_ID_ALLOCATION_FAILED",
    });
  });

  it("cleans up the just-written product file when the index write fails, preserving foreign content", async () => {
    const home = await testHome();
    const products = new ProductService({ home });
    const actualYaml = await vi.importActual<typeof import("../src/yaml.js")>("../src/yaml.js");

    vi.mocked(writeYamlAtomic).mockImplementation(async (file: string, value: unknown) => {
      if (file.endsWith("products.yaml")) {
        throw new Error("index write failed");
      }
      return actualYaml.writeYamlAtomic(file, value);
    });

    await expect(products.createProduct({ name: "P", description: "d" })).rejects.toThrow("index write failed");

    // No orphan product.yaml under data/ for the failed create
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(home, "data"), { withFileTypes: true }).catch(() => []);
    const productDirs = entries.filter((e) => e.isDirectory() && /^P-[a-f0-9]{6}$/.test(e.name));
    expect(productDirs).toEqual([]);
  });
});
