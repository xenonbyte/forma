import { fileURLToPath } from "node:url";
import { buildServer, isLoopbackHost, type BuildServerOptions } from "./app.js";

export { formaCoreVersion } from "@xenonbyte/forma-core";
export {
  buildServer,
  isLoopbackHost,
  type BuildServerOptions,
  type FormaServer,
  type FormaServerStore,
} from "./app.js";
export { registerRoutes, RouteHttpError, RouteInputError, type FormaRoutesStore, type FormaStore } from "./routes.js";

export interface StartServerOptions extends BuildServerOptions {
  host?: string;
  port?: number;
}

export async function main(options: StartServerOptions = {}): Promise<void> {
  const port = options.port ?? Number(process.env.FORMA_SERVER_PORT ?? 3000);
  const host = options.host ?? process.env.FORMA_SERVER_HOST ?? "127.0.0.1";
  const configuredAuthToken = options.authToken !== undefined ? options.authToken : process.env.FORMA_SERVER_TOKEN;
  const authToken = requireAuthTokenForHost(host, configuredAuthToken);
  const app = await buildServer({ ...options, authToken });
  await app.listen({ host, port });
}

// Loopback binds run unauthenticated only when no token is configured. For any
// exposed host we refuse to start without an explicit token rather than silently
// open an unauthenticated, fully-mutating API to the network.
export function requireAuthTokenForHost(host: string, token: string | undefined): string | undefined {
  const trimmed = token?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (isLoopbackHost(host)) {
    return undefined;
  }
  throw new Error(
    `Refusing to bind the Forma server to non-loopback host "${host}" without authentication. ` +
      'Set FORMA_SERVER_TOKEN to a secret (clients then send it as "Authorization: Bearer <token>"), ' +
      "or bind to 127.0.0.1 for local-only use.",
  );
}

export const start = main;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
