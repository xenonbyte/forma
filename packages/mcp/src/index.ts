import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
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
}

export function createFormaMcpServer(options: CreateFormaMcpServerOptions = {}): McpServer {
  const store = createFormaStore({
    home: options.home ?? defaultFormaHome(),
    bundledStylesDir: options.bundledStylesDir
  });
  const server = new McpServer({ name: "forma", version: formaCoreVersion });
  registerFormaTools(server, createFormaTools(store, { pencil: options.pencil }));
  return server;
}

export async function main(options: CreateFormaMcpServerOptions = {}): Promise<void> {
  const server = createFormaMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export const start = main;

function defaultFormaHome(): string {
  return process.env.FORMA_HOME ?? join(homedir(), ".forma");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
