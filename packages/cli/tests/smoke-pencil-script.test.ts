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
  return readPackageJson("package.json") as Promise<PackageJson & {
    scripts?: Record<string, string>;
  }>;
}

interface PackageJson {
  name: string;
  private?: boolean;
  description?: string;
  license?: string;
  repository?: {
    type?: string;
    url?: string;
    directory?: string;
  };
  homepage?: string;
  bugs?: {
    url?: string;
  };
  engines?: {
    node?: string;
  };
  files?: string[];
  publishConfig?: {
    access?: string;
  };
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

async function readPackageJson(file: string): Promise<PackageJson> {
  return JSON.parse(await readFile(resolve(file), "utf8")) as PackageJson;
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

  it("keeps the live GitHub and Pencil check bounded", async () => {
    const script = await readLiveSyncScript();

    expect(script).toContain("syncStyleLimit: liveStyleLimit");
    expect(script).toContain("const liveStyleLimit = 2");
    expect(script).toContain("const maxWaitMs = 5 * 60 * 1_000");
  });

  it("terminates explicitly on failure instead of only setting an exit code", async () => {
    const script = await readLiveSyncScript();

    expect(script).toContain("process.exit(1)");
    expect(script).not.toContain("process.exitCode = 1");
  });
});

describe("npm publish package configuration", () => {
  const repositoryUrl = "git+https://github.com/xenonbyte/forma.git";
  const homepage = "https://github.com/xenonbyte/forma#readme";
  const bugsUrl = "https://github.com/xenonbyte/forma/issues";

  const publishPackages = [
    { file: "packages/core/package.json", directory: "packages/core", files: ["dist"] },
    { file: "packages/mcp/package.json", directory: "packages/mcp", files: ["dist"] },
    { file: "packages/server/package.json", directory: "packages/server", files: ["dist"] },
    { file: "packages/cli/package.json", directory: "packages/cli", files: ["bin", "dist"] }
  ] as const;

  it("keeps publishable packages explicit and public", async () => {
    for (const entry of publishPackages) {
      const packageJson = await readPackageJson(entry.file);

      expect(packageJson.private).not.toBe(true);
      expect(packageJson.description).toEqual(expect.any(String));
      expect(packageJson.license).toBe("UNLICENSED");
      expect(packageJson.engines?.node).toBe(">=22");
      expect(packageJson.files).toEqual(entry.files);
      expect(packageJson.publishConfig?.access).toBe("public");
      expect(packageJson.repository).toEqual({
        type: "git",
        url: repositoryUrl,
        directory: entry.directory
      });
      expect(packageJson.homepage).toBe(homepage);
      expect(packageJson.bugs?.url).toBe(bugsUrl);
    }
  });

  it("keeps private workspace-only packages unpublished", async () => {
    await expect(readPackageJson("packages/agent/package.json")).resolves.toMatchObject({
      name: "@xenonbyte/forma-agent",
      private: true
    });
    await expect(readPackageJson("packages/web/package.json")).resolves.toMatchObject({
      name: "@xenonbyte/forma-web",
      private: true
    });
  });

  it("publishes the runtime dependency chain without the private agent package", async () => {
    const rootPackage = await readRootPackageJson();
    const cliPackage = await readPackageJson("packages/cli/package.json");

    expect(rootPackage.scripts?.["pack:publish"]).toContain("@xenonbyte/forma-core pack --dry-run");
    expect(rootPackage.scripts?.["pack:publish"]).toContain("@xenonbyte/forma-cli pack --dry-run");
    expect(rootPackage.scripts?.["pack:publish"]?.startsWith("pnpm build && ")).toBe(true);
    expect(rootPackage.scripts?.["publish:npm"]).toBe(
      "pnpm build && pnpm --filter @xenonbyte/forma-core publish && pnpm --filter @xenonbyte/forma-mcp publish && pnpm --filter @xenonbyte/forma-server publish && pnpm --filter @xenonbyte/forma-cli publish"
    );
    expect(cliPackage.dependencies).not.toHaveProperty("@xenonbyte/forma-agent");
  });
});
