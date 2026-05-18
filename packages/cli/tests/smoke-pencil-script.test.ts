import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function readSmokeScript() {
  return await readFile(resolve("scripts/smoke-pencil.ts"), "utf8");
}

describe("smoke-pencil script", () => {
  it("does not print raw generic error messages", async () => {
    const script = await readSmokeScript();

    expect(script).not.toContain("console.error(error.message)");
    expect(script).not.toContain("console.error(String(error))");
    expect(script).toContain("sanitizeGenericErrorForLog");
    expect(script).toContain("redactSensitiveFields");
  });

  it("keeps smoke environment and prompt contracts explicit", async () => {
    const script = await readSmokeScript();

    expect(script).toContain("/opt/homebrew/bin");
    expect(script).toContain("/usr/local/bin");
    expect(script).toContain("getRequirement({ requirement_id: requirement.id })");
    expect(script).toContain("document_md.includes(smokePrompt)");
  });
});
