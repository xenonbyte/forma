import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { createFormaStore, formaCoreVersion, isSchemaNormalizationStartupError } from "@xenonbyte/forma-core";
import { createFormaTools, registerFormaTools, registerLimitedFormaTools } from "./tools.js";

export { formaCoreVersion } from "@xenonbyte/forma-core";
export {
  createFormaTools,
  formaToolInputSchemas,
  formaToolNames,
  registerFormaTools,
  type FormaToolHandler,
  type FormaToolName,
  type FormaToolResult,
  type FormaTools,
} from "./tools.js";

export interface CreateFormaMcpServerOptions {
  home?: string;
  bundledStylesDir?: string;
  logger?: FormaMcpLogger;
}

export interface FormaMcpLogger {
  warn(input: { warning: string }, message: string): void;
}

export async function createFormaMcpServer(options: CreateFormaMcpServerOptions = {}): Promise<McpServer> {
  const home = options.home ?? defaultFormaHome();
  let store;
  try {
    store = await createFormaStore({
      home,
      bundledStylesDir: options.bundledStylesDir,
    });
  } catch (error) {
    if (!isSchemaNormalizationStartupError(error)) {
      throw error;
    }
    const server = new McpServer({ name: "forma", version: formaCoreVersion });
    registerLimitedFormaTools(server, error.state);
    return server;
  }

  const recovery = await store.recoverPendingProductDeletes();
  for (const warning of recovery.warnings) {
    logRecoveryWarning(warning, options.logger);
  }

  const server = new McpServer({ name: "forma", version: formaCoreVersion });
  registerFormaTools(server, createFormaTools(store));
  return server;
}

export async function main(options: CreateFormaMcpServerOptions = {}): Promise<void> {
  const server = await createFormaMcpServer(options);
  const transport = new StdioServerTransport();
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
