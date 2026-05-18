import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatGenericErrorForLog, sanitizeGenericErrorForLog } from "../../../scripts/smoke-pencil-error.js";

async function readSmokeScript() {
  return await readFile(resolve("scripts/smoke-pencil.ts"), "utf8");
}

async function readLiveSyncScript() {
  return await readFile(resolve("scripts/live-style-sync.ts"), "utf8");
}

async function readRootPackageJson() {
  return JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
}

describe("smoke-pencil script", () => {
  it("does not print raw generic error messages", async () => {
    const script = await readSmokeScript();

    expect(script).not.toContain("console.error(error.message)");
    expect(script).not.toContain("console.error(String(error))");
    expect(script).toContain("formatGenericErrorForLog");
  });

  it("keeps smoke environment and prompt contracts explicit", async () => {
    const script = await readSmokeScript();

    expect(script).toContain("/opt/homebrew/bin");
    expect(script).toContain("/usr/local/bin");
    expect(script).toContain("getRequirement({ requirement_id: requirement.id })");
    expect(script).toContain("document_md.includes(smokePrompt)");
  });

  it("redacts common secret, account, user, and session fields", () => {
    const sanitized = sanitizeGenericErrorForLog(
      new Error(
        [
          "session_id=sess-123",
          "account-id=acct-42",
          "userId=user-99",
          "authToken=tok-abc",
          "token=plain",
          "apiKey=key-123",
          "refresh-token=refresh-123",
          "cookie=session-cookie",
          "email=person@example.com"
        ].join(" ")
      )
    );

    expect(sanitized).toContain("session_id=<redacted>");
    expect(sanitized).toContain("account-id=<redacted>");
    expect(sanitized).toContain("userId=<redacted>");
    expect(sanitized).toContain("authToken=<redacted>");
    expect(sanitized).toContain("token=<redacted>");
    expect(sanitized).toContain("apiKey=<redacted>");
    expect(sanitized).toContain("refresh-token=<redacted>");
    expect(sanitized).toContain("cookie=<redacted>");
    for (const leaked of ["sess-123", "acct-42", "user-99", "tok-abc", "plain", "key-123", "refresh-123", "session-cookie", "person@example.com"]) {
      expect(sanitized).not.toContain(leaked);
    }
  });

  it("keeps command failure output to exit code only", () => {
    const formatted = formatGenericErrorForLog(Object.assign(new Error("token=plain session_id=sess-123"), { exitCode: 17 }));

    expect(formatted).toBe("Unexpected error: command failed (exitCode=17)");
  });
});

describe("live style sync script", () => {
  it("keeps live sync opt-in and out of offline tests", async () => {
    const packageJson = await readRootPackageJson();
    const testLiveScript = packageJson.scripts?.["test:live"] ?? "";

    expect(packageJson.scripts?.test).toBe("vitest run");
    expect(packageJson.scripts?.test).not.toContain("test:live");
    expect(packageJson.scripts?.test).not.toContain("live-style-sync");
    expect(testLiveScript).toContain("pnpm --filter @xenonbyte/forma-core build");
    expect(testLiveScript).toContain("tsx scripts/live-style-sync.ts");
  });

  it("uses real dependencies without mock or skip markers", async () => {
    const script = await readLiveSyncScript();

    expect(script).toContain("createFormaStore");
    expect(script).toContain("startSync");
    expect(script.toLowerCase()).not.toContain("mock");
    expect(script.toLowerCase()).not.toContain("skip");
  });
});
