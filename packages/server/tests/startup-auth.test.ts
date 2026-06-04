import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildServerOptions, FormaServer } from "../src/app.js";

const mocks = vi.hoisted(() => ({
  buildServer: vi.fn(),
  listen: vi.fn()
}));

vi.mock("../src/app.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/app.js")>();
  return {
    ...actual,
    buildServer: mocks.buildServer
  };
});

const { main } = await import("../src/index.js");

describe("server startup auth normalization", () => {
  const originalEnv = {
    FORMA_SERVER_HOST: process.env.FORMA_SERVER_HOST,
    FORMA_SERVER_PORT: process.env.FORMA_SERVER_PORT,
    FORMA_SERVER_TOKEN: process.env.FORMA_SERVER_TOKEN
  };

  beforeEach(() => {
    delete process.env.FORMA_SERVER_HOST;
    delete process.env.FORMA_SERVER_PORT;
    delete process.env.FORMA_SERVER_TOKEN;
    mocks.listen.mockResolvedValue(undefined);
    mocks.buildServer.mockResolvedValue({ listen: mocks.listen } as unknown as FormaServer);
  });

  afterEach(() => {
    restoreEnv("FORMA_SERVER_HOST", originalEnv.FORMA_SERVER_HOST);
    restoreEnv("FORMA_SERVER_PORT", originalEnv.FORMA_SERVER_PORT);
    restoreEnv("FORMA_SERVER_TOKEN", originalEnv.FORMA_SERVER_TOKEN);
    vi.clearAllMocks();
  });

  it("treats a blank configured host as exposed and refuses to start without auth", async () => {
    await expect(main({ host: "", port: 0 })).rejects.toThrow(/without authentication/);

    expect(mocks.buildServer).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it("rejects an explicitly blank authToken for exposed hosts before starting", async () => {
    await expect(main({ host: "0.0.0.0", port: 0, authToken: "   " })).rejects.toThrow(/without authentication/);

    expect(mocks.buildServer).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it("uses FORMA_SERVER_TOKEN on loopback binds", async () => {
    process.env.FORMA_SERVER_TOKEN = "  local-secret  ";

    await main({ host: "127.0.0.1", port: 0 });

    expect(mocks.buildServer).toHaveBeenCalledWith(expect.objectContaining<Partial<BuildServerOptions>>({ authToken: "local-secret" }));
    expect(mocks.listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 0 });
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
