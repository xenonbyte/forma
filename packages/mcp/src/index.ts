import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { createFormaStore, formaCoreVersion } from "@xenonbyte/forma-core";
import { createFormaTools, registerFormaTools, type CreateFormaToolsOptions } from "./tools.js";

export { formaCoreVersion } from "@xenonbyte/forma-core";
export {
  createFormaTools,
  formaToolInputSchemas,
  formaToolNames,
  registerFormaTools,
  type CreateFormaToolsOptions,
  type FormaToolHandler,
  type FormaToolName,
  type FormaToolResult,
  type FormaTools
} from "./tools.js";

export interface CreateFormaMcpServerOptions extends CreateFormaToolsOptions {
  home?: string;
  bundledStylesDir?: string;
  logger?: FormaMcpLogger;
}

export interface FormaMcpLogger {
  warn(input: { warning: string }, message: string): void;
}

type StdioServerTransportConstructor = new () => Parameters<McpServer["connect"]>[0];

export async function createFormaMcpServer(options: CreateFormaMcpServerOptions = {}): Promise<McpServer> {
  const store = createFormaStore({
    home: options.home ?? defaultFormaHome(),
    bundledStylesDir: options.bundledStylesDir
  });
  const recovery = await store.recoverPendingProductDeletes();
  for (const warning of recovery.warnings) {
    logRecoveryWarning(warning, options.logger);
  }

  const server = new McpServer({ name: "forma", version: formaCoreVersion });
  registerFormaTools(server, createFormaTools(store, { pencil: options.pencil }));
  return server;
}

export async function main(options: CreateFormaMcpServerOptions = {}): Promise<void> {
  const server = await createFormaMcpServer(options);
  const Transport = await loadStdioServerTransport();
  const transport = new Transport();
  await server.connect(transport);
}

export const start = main;

function defaultFormaHome(): string {
  return process.env.FORMA_HOME ?? join(homedir(), ".forma");
}

function logRecoveryWarning(warning: string, logger?: FormaMcpLogger): void {
  if (logger) {
    logger.warn({ warning }, "Forma product deletion recovery warning");
    return;
  }

  console.error(`Forma product deletion recovery warning: ${warning}`);
}

async function loadStdioServerTransport(): Promise<StdioServerTransportConstructor> {
  const docsPath = "@modelcontextprotocol/server/stdio";
  try {
    const module = await import(docsPath);
    return (module as { StdioServerTransport: StdioServerTransportConstructor }).StdioServerTransport;
  } catch (error) {
    if (!isPackagePathNotExported(error)) {
      throw error;
    }
    console.error("@modelcontextprotocol/server/stdio is not exported by the installed MCP server package; using root export.");
    const module = await import("@modelcontextprotocol/server");
    return (module as { StdioServerTransport: StdioServerTransportConstructor }).StdioServerTransport;
  }
}

function isPackagePathNotExported(error: unknown): boolean {
  return error instanceof Error && (
    ("code" in error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") ||
    error.message.includes("Missing \"./stdio\" specifier")
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
