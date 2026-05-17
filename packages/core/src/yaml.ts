import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as {
  load(source: string): unknown;
  dump(value: unknown, options?: { noRefs?: boolean; sortKeys?: boolean }): string;
};

export async function readYaml<T>(file: string): Promise<T> {
  return yaml.load(await readFile(file, "utf8")) as T;
}

export async function writeYamlAtomic(file: string, value: unknown): Promise<void> {
  const parentDir = dirname(file);
  await mkdir(parentDir, { recursive: true });

  const tempFile = join(parentDir, `.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(tempFile, yaml.dump(value, { noRefs: true, sortKeys: true }), "utf8");
    await rename(tempFile, file);
  } catch (error) {
    await rm(tempFile, { force: true });
    throw error;
  }
}
