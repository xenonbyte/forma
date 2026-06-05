import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatGenericErrorForLog, sanitizeGenericErrorForLog } from "../../../scripts/smoke-pencil-error.js";

async function readRootPackageJson() {
  return readPackageJson("package.json") as Promise<
    PackageJson & {
      scripts?: Record<string, string>;
    }
  >;
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
  it("does not expose removed live Pencil scripts from root package scripts", async () => {
    const packageJson = await readRootPackageJson();

    expect(packageJson.scripts).not.toHaveProperty("test:live");
    expect(packageJson.scripts).not.toHaveProperty("smoke:pencil");
    expect(packageJson.scripts).not.toHaveProperty("smoke:pencil:foreground");
    await expect(access(resolve("scripts/live-style-sync.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(resolve("scripts/smoke-pencil.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(resolve("scripts/smoke-pencil-foreground.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the root workspace engine aligned with documented Node support", async () => {
    const packageJson = await readRootPackageJson();

    expect(packageJson.engines?.node).toBe(">=22");
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
          "email=person@example.com",
        ].join(" "),
      ),
    );

    expect(sanitized).toContain("session_id=<redacted>");
    expect(sanitized).toContain("account-id=<redacted>");
    expect(sanitized).toContain("userId=<redacted>");
    expect(sanitized).toContain("authToken=<redacted>");
    expect(sanitized).toContain("token=<redacted>");
    expect(sanitized).toContain("apiKey=<redacted>");
    expect(sanitized).toContain("refresh-token=<redacted>");
    expect(sanitized).toContain("cookie=<redacted>");
    for (const leaked of [
      "sess-123",
      "acct-42",
      "user-99",
      "tok-abc",
      "plain",
      "key-123",
      "refresh-123",
      "session-cookie",
      "person@example.com",
    ]) {
      expect(sanitized).not.toContain(leaked);
    }
  });

  it("keeps command failure output to exit code only", () => {
    const formatted = formatGenericErrorForLog(
      Object.assign(new Error("token=plain session_id=sess-123"), { exitCode: 17 }),
    );

    expect(formatted).toBe("Unexpected error: command failed (exitCode=17)");
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
    { file: "packages/cli/package.json", directory: "packages/cli", files: ["bin", "dist"] },
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
        directory: entry.directory,
      });
      expect(packageJson.homepage).toBe(homepage);
      expect(packageJson.bugs?.url).toBe(bugsUrl);
    }
  });

  it("keeps private workspace-only packages unpublished", async () => {
    await expect(readPackageJson("packages/agent/package.json")).resolves.toMatchObject({
      name: "@xenonbyte/forma-agent",
      private: true,
    });
    await expect(readPackageJson("packages/web/package.json")).resolves.toMatchObject({
      name: "@xenonbyte/forma-web",
      private: true,
    });
  });

  it("publishes the runtime dependency chain without the private agent package", async () => {
    const rootPackage = await readRootPackageJson();
    const cliPackage = await readPackageJson("packages/cli/package.json");
    const packScript = rootPackage.scripts?.["pack:publish"] ?? "";
    const publishScript = rootPackage.scripts?.["publish:npm"] ?? "";
    const publicRuntimePackages = [
      "@vzi-core/types",
      "@vzi-core/format",
      "@vzi-core/parser",
      "@vzi-core/transformer",
      "@xenonbyte/forma-core",
      "@xenonbyte/forma-mcp",
      "@xenonbyte/forma-server",
      "@xenonbyte/forma-cli",
    ];

    expect(packScript.startsWith("pnpm build && ")).toBe(true);
    for (const packageName of publicRuntimePackages) {
      expect(packScript).toContain(`--filter ${packageName} pack --dry-run`);
      expect(publishScript).toContain(`--filter ${packageName} publish`);
    }
    expect(publishScript.indexOf("@vzi-core/transformer publish")).toBeLessThan(
      publishScript.indexOf("@xenonbyte/forma-core publish"),
    );
    expect(publishScript.indexOf("@vzi-core/transformer publish")).toBeLessThan(
      publishScript.indexOf("@xenonbyte/forma-mcp publish"),
    );
    expect(publishScript).not.toContain("@xenonbyte/forma-agent publish");
    expect(cliPackage.dependencies).not.toHaveProperty("@xenonbyte/forma-agent");
  });
});
