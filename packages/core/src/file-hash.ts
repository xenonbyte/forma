import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function hashFile(file: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}
