import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createFormaStore: vi.fn(),
  readSchemaNormalizationRecoveryState: vi.fn(),
  serverInstances: [] as Array<{ registerTool: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }>,
  transportInstances: [] as object[],
}));

vi.mock("@xenonbyte/forma-core", () => {
  class FormaError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly details: Record<string, unknown> = {},
    ) {
      super(message);
      this.name = "FormaError";
    }

    toJSON() {
      return { error_code: this.code, message: this.message, details: this.details };
    }
  }

  class SchemaNormalizationStartupError extends Error {
    readonly code: string;

    constructor(public readonly state: Record<string, unknown>) {
      super(String(state.message ?? "Schema normalization startup blocked"));
      this.name = "SchemaNormalizationStartupError";
      this.code = String(state.code ?? "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED");
    }
  }

  return {
    FormaError,
    SchemaNormalizationStartupError,
    PencilService: class {
      generatePageDesign = vi.fn();
    },
    assertProductConfig: vi.fn(),
    createFormaStore: mocks.createFormaStore,
    isSchemaNormalizationStartupError: (error: unknown) => error instanceof SchemaNormalizationStartupError,
    readSchemaNormalizationRecoveryState: mocks.readSchemaNormalizationRecoveryState,
    formaCoreVersion: "0.0.0-test",
    languages: ["en", "zh-CN"],
    platforms: ["web", "mobile"],
  };
});

vi.mock("@modelcontextprotocol/server", () => {
  class McpServer {
    registerTool = vi.fn();
    connect = vi.fn(async () => undefined);

    constructor() {
      mocks.serverInstances.push(this);
    }
  }

  class StdioServerTransport {
    constructor() {
      mocks.transportInstances.push(this);
    }
  }

  return { McpServer, StdioServerTransport };
});

function fakeStore(overrides: Record<string, unknown> = {}) {
  return {
    home: "/tmp/forma",
    recoverPendingProductDeletes: vi.fn(async () => ({ recovered: 0, cleaned: 0, warnings: [] })),
    deleteProduct: vi.fn(),
    generateComponents: vi.fn(),
    baseline: { getProductBaseline: vi.fn() },
    copy: { getTranslations: vi.fn(), updatePageTranslations: vi.fn() },
    products: {
      getProduct: vi.fn(),
      initProductConfig: vi.fn(),
      listProducts: vi.fn(),
    },
    requirements: {
      getProductRules: vi.fn(),
      getRequirement: vi.fn(),
      getRequirementHistory: vi.fn(),
      saveRequirement: vi.fn(),
    },
    sessions: { getCurrentSession: vi.fn(), setCurrentProduct: vi.fn() },
    styles: { getStyle: vi.fn(), listStyles: vi.fn() },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function nextTick(): Promise<void> {
  await new Promise((resolveTick) => setTimeout(resolveTick, 0));
}

async function importIndex() {
  return import("../src/index.js");
}

function expectNoToolRegistrations(): void {
  for (const server of mocks.serverInstances) {
    expect(server.registerTool).not.toHaveBeenCalled();
  }
}

function expectNoTransportConnections(): void {
  for (const server of mocks.serverInstances) {
    expect(server.connect).not.toHaveBeenCalled();
  }
}

describe("MCP server startup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.serverInstances.length = 0;
    mocks.transportInstances.length = 0;
    mocks.createFormaStore.mockReturnValue(fakeStore());
    mocks.readSchemaNormalizationRecoveryState.mockResolvedValue({
      mode: "normal",
      status: "committed",
      message: "v6 schema normalization committed",
      home: "/tmp/forma",
      restore_status: "none",
      failed_files: [],
      recovery_actions: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createFormaMcpServer is async and waits for delete recovery before registering tools", async () => {
    const recovery = deferred<{ recovered: number; cleaned: number; warnings: string[] }>();
    const store = fakeStore({
      recoverPendingProductDeletes: vi.fn(() => recovery.promise),
    });
    mocks.createFormaStore.mockReturnValue(store);
    const { createFormaMcpServer } = await importIndex();

    const serverPromise = createFormaMcpServer({ home: "/tmp/custom-home", bundledStylesDir: "/tmp/styles" });

    expect(serverPromise).toBeInstanceOf(Promise);
    await nextTick();
    expect(mocks.createFormaStore).toHaveBeenCalledWith({ home: "/tmp/custom-home", bundledStylesDir: "/tmp/styles" });
    expectNoToolRegistrations();

    recovery.resolve({ recovered: 0, cleaned: 0, warnings: [] });
    const server = await serverPromise;

    expect(server).toBe(mocks.serverInstances[0]);
    expect(store.recoverPendingProductDeletes).toHaveBeenCalledTimes(1);
    expect(mocks.serverInstances[0]!.registerTool).toHaveBeenCalled();
    // First test in this suite pays the one-time cold dynamic-import transform
    // of the vzi/core/mcp graph (vi.resetModules re-imports per test); under
    // full-suite parallel load that can exceed the 5s default. Logic is fast
    // (passes <1s in isolation) — give the cold import headroom.
  }, 30_000);

  it("logs recovery warnings to an injected logger", async () => {
    const logger = { warn: vi.fn() };
    mocks.createFormaStore.mockReturnValue(
      fakeStore({
        recoverPendingProductDeletes: vi.fn(async () => ({
          recovered: 1,
          cleaned: 1,
          warnings: ["rolled back deletion", "cleaned committed deletion"],
        })),
      }),
    );
    const { createFormaMcpServer } = await importIndex();

    await createFormaMcpServer({ logger });

    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      { warning: "rolled back deletion" },
      "Forma product deletion recovery warning",
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      { warning: "cleaned committed deletion" },
      "Forma product deletion recovery warning",
    );
  });

  it("logs recovery warnings to stderr when no logger is provided", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createFormaStore.mockReturnValue(
      fakeStore({
        recoverPendingProductDeletes: vi.fn(async () => ({
          recovered: 1,
          cleaned: 0,
          warnings: ["rollback warning"],
        })),
      }),
    );
    const { createFormaMcpServer } = await importIndex();

    await createFormaMcpServer();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("rollback warning"));
  });

  it("rejects the factory when delete recovery fails", async () => {
    const recoveryError = new Error("recovery failed");
    mocks.createFormaStore.mockReturnValue(
      fakeStore({
        recoverPendingProductDeletes: vi.fn(async () => {
          throw recoveryError;
        }),
      }),
    );
    const { createFormaMcpServer } = await importIndex();

    await expect(createFormaMcpServer()).rejects.toThrow("recovery failed");
    expectNoToolRegistrations();
  });

  it("registers limited status and blocked tool handlers when schema normalization preflight blocks startup", async () => {
    const state = {
      mode: "preflight_only",
      status: "preflight_required",
      code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
      message: "v6 schema normalization preflight is required",
      home: "/tmp/custom-home",
      preflight_status: "missing",
      preflight_reason: "report_missing",
      restore_status: "none",
      failed_files: [],
      recovery_actions: ["run_schema_normalization_dry_run", "run_v6_schema_cutover"],
    };
    const rereadState = {
      ...state,
      preflight_status: "stale",
      preflight_reason: "report_stale",
    };
    const { SchemaNormalizationStartupError } = await import("@xenonbyte/forma-core");
    mocks.createFormaStore.mockRejectedValue(new SchemaNormalizationStartupError(state));
    mocks.readSchemaNormalizationRecoveryState.mockResolvedValue(rereadState);
    const { createFormaMcpServer } = await importIndex();

    await createFormaMcpServer({ home: "/tmp/custom-home" });
    const server = mocks.serverInstances[0]!;
    const statusCall = server.registerTool.mock.calls.find((call) => call[0] === "fm-status");
    const blockedCall = server.registerTool.mock.calls.find((call) => call[0] === "list_products");

    expect(statusCall).toBeTruthy();
    expect(blockedCall).toBeTruthy();
    const statusResult = await statusCall![2]({});
    const blockedResult = await blockedCall![2]({});

    expect(JSON.parse(statusResult.content[0]!.text)).toEqual({ schema_normalization: state });
    expect(mocks.readSchemaNormalizationRecoveryState).not.toHaveBeenCalled();
    expect(blockedResult.isError).toBe(true);
    expect(JSON.parse(blockedResult.content[0]!.text)).toEqual({
      error_code: "SCHEMA_NORMALIZATION_PREFLIGHT_REQUIRED",
      message: "Schema normalization preflight required",
      details: state,
    });
  });

  it("keeps unrelated store startup errors fatal", async () => {
    mocks.createFormaStore.mockRejectedValue(new Error("store exploded"));
    const { createFormaMcpServer } = await importIndex();

    await expect(createFormaMcpServer({ home: "/tmp/custom-home" })).rejects.toThrow("store exploded");
    expectNoToolRegistrations();
  });

  it("main connects stdio only after async factory recovery resolves", async () => {
    const recovery = deferred<{ recovered: number; cleaned: number; warnings: string[] }>();
    mocks.createFormaStore.mockReturnValue(
      fakeStore({
        recoverPendingProductDeletes: vi.fn(() => recovery.promise),
      }),
    );
    const { main } = await importIndex();

    const mainPromise = main({ home: "/tmp/custom-home" });

    await nextTick();
    expectNoTransportConnections();

    recovery.resolve({ recovered: 0, cleaned: 0, warnings: [] });
    await mainPromise;

    expect(mocks.transportInstances).toHaveLength(1);
    expect(mocks.serverInstances[0]!.connect).toHaveBeenCalledWith(mocks.transportInstances[0]);
  });

  it("main uses the root stdio transport without fallback warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { main } = await importIndex();

    await main({ home: "/tmp/custom-home" });

    expect(mocks.transportInstances).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining("server/stdio is not exported"));
  });

  it("main does not connect stdio when recovery rejects", async () => {
    mocks.createFormaStore.mockReturnValue(
      fakeStore({
        recoverPendingProductDeletes: vi.fn(async () => {
          throw new Error("recovery failed");
        }),
      }),
    );
    const { main } = await importIndex();

    await expect(main({ home: "/tmp/custom-home" })).rejects.toThrow("recovery failed");

    expect(mocks.transportInstances).toHaveLength(0);
    expectNoTransportConnections();
  });
});
