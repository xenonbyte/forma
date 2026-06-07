/**
 * Guard: packages/core runs inside the MCP stdio server where stdout carries
 * JSON-RPC frames. console.log writes to stdout and corrupts the protocol
 * stream; console.warn / console.error go to stderr and are allowed.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("core source hygiene", () => {
  it("contains no console.log (stdout is reserved for the MCP stdio protocol)", async () => {
    const offenders: string[] = [];
    for (const file of await listTsFiles(SRC_DIR)) {
      const text = await readFile(file, "utf8");
      for (const [index, line] of text.split("\n").entries()) {
        if (line.includes("console.log(")) {
          offenders.push(`${file}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
