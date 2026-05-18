import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { z } from "zod";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as {
  load(source: string): unknown;
  dump(value: unknown, options?: { noRefs?: boolean; sortKeys?: boolean }): string;
};

export async function readYamlUnknown(file: string): Promise<unknown> {
  return yaml.load(await readFile(file, "utf8"));
}

export async function readYamlAs<TSchema extends z.ZodType>(file: string, schema: TSchema): Promise<z.infer<TSchema>> {
  return schema.parse(await readYamlUnknown(file));
}

export async function readYaml<T>(file: string): Promise<T> {
  return (await readYamlUnknown(file)) as T;
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
