import { fileURLToPath } from "node:url";
import { buildServer, type BuildServerOptions } from "./app.js";

export { formaCoreVersion } from "@xenonbyte/forma-core";
export { buildServer, type BuildServerOptions, type FormaServer, type FormaServerStore } from "./app.js";
export { registerRoutes, RouteHttpError, RouteInputError, type FormaRoutesStore, type FormaStore } from "./routes.js";

export interface StartServerOptions extends BuildServerOptions {
  host?: string;
  port?: number;
}

export async function main(options: StartServerOptions = {}): Promise<void> {
  const app = await buildServer(options);
  const port = options.port ?? Number(process.env.FORMA_SERVER_PORT ?? 3000);
  const host = options.host ?? process.env.FORMA_SERVER_HOST ?? "127.0.0.1";
  await app.listen({ host, port });
}

export const start = main;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
