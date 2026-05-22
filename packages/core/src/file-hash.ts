import { createHash, type BinaryLike } from "node:crypto";
import { readFile } from "node:fs/promises";

export function hashBytes(bytes: BinaryLike): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function hashFile(file: string): Promise<string> {
  return hashBytes(await readFile(file));
}
