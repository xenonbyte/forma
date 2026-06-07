import { existsSync } from "fs";
import { isAbsolute, join, relative, resolve, sep } from "path";

const MIN_ELECTRON_VERSION = 41;
const DEFAULT_FORMA_SERVER_PORT = 3000;

export interface FormaDesktopClient {
  listProducts(): Promise<unknown>;
  getProduct(id: string): Promise<unknown>;
  listArtifacts(productId: string): Promise<unknown>;
  getArtifact(productId: string, artifactId: string): Promise<unknown>;
  listRequirements(productId: string): Promise<unknown>;
  getRequirement(productId: string, requirementId: string): Promise<unknown>;
  serverStatus(): Promise<boolean>;
  serverBaseUrl(): string;
  listStyles(): Promise<unknown>;
  getStyle(name: string): Promise<unknown>;
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export function assertElectronVersion(): void {
  const version = parseInt(process.versions.electron.split(".")[0], 10);
  if (version < MIN_ELECTRON_VERSION) {
    throw new Error(
      `FORMA_DESKTOP_CONFIG_UNSUPPORTED: Electron ${process.versions.electron} is below minimum required ${MIN_ELECTRON_VERSION}.x`,
    );
  }
}

export function resolveRendererIndexPath(mainDir: string): string {
  return join(mainDir, "../renderer/index.html");
}

export function registerFormaIpcHandlers(
  ipcMain: IpcMainLike,
  client: FormaDesktopClient = createFormaHttpClient(),
): void {
  ipcMain.handle("forma:listProducts", () => client.listProducts());
  ipcMain.handle("forma:getProduct", (_event, id) => client.getProduct(requireIpcString(id, "id")));
  ipcMain.handle("forma:listArtifacts", (_event, productId) =>
    client.listArtifacts(requireIpcString(productId, "productId")),
  );
  ipcMain.handle("forma:getArtifact", (_event, productId, artifactId) =>
    client.getArtifact(requireIpcString(productId, "productId"), requireIpcString(artifactId, "artifactId")),
  );
  ipcMain.handle("forma:listRequirements", (_event, productId) =>
    client.listRequirements(requireIpcString(productId, "productId")),
  );
  ipcMain.handle("forma:getRequirement", (_event, productId, requirementId) =>
    client.getRequirement(requireIpcString(productId, "productId"), requireIpcString(requirementId, "requirementId")),
  );
  ipcMain.handle("forma:serverStatus", () => client.serverStatus());
  ipcMain.handle("forma:serverBaseUrl", () => client.serverBaseUrl());
  ipcMain.handle("forma:listStyles", () => client.listStyles());
  ipcMain.handle("forma:getStyle", (_event, name) => client.getStyle(requireIpcString(name, "name")));
}

export function createFormaHttpClient(options: { baseUrl?: string; fetchFn?: typeof fetch } = {}): FormaDesktopClient {
  const baseUrl = options.baseUrl ?? defaultFormaServerBaseUrl();
  const fetchFn = options.fetchFn ?? fetch;

  async function getJson<T>(path: string): Promise<T> {
    const response = await fetchFn(`${baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`FORMA_SERVER_REQUEST_FAILED: ${response.status} ${path}`);
    }
    const payload = (await response.json()) as unknown;
    return absolutizePreviewUrls(payload, baseUrl) as T;
  }

  return {
    async listProducts() {
      const products = await getJson<unknown>("/api/products");
      return Array.isArray(products) ? { products } : products;
    },
    getProduct: (id) => getJson(`/api/products/${encodeURIComponent(id)}`),
    listArtifacts: (productId) => getJson(`/api/products/${encodeURIComponent(productId)}/artifacts`),
    getArtifact: (productId, artifactId) =>
      getJson(`/api/products/${encodeURIComponent(productId)}/artifacts/${encodeURIComponent(artifactId)}`),
    async listRequirements(productId) {
      const requirements = await getJson<unknown>(`/api/products/${encodeURIComponent(productId)}/requirements`);
      return Array.isArray(requirements) ? { requirements } : requirements;
    },
    getRequirement: (productId, requirementId) =>
      getJson(`/api/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}`),
    async serverStatus() {
      try {
        const response = await fetchFn(`${baseUrl}/api/health`);
        return response.ok;
      } catch {
        return false;
      }
    },
    serverBaseUrl: () => baseUrl,
    listStyles: () => getJson("/api/styles"),
    getStyle: (name) => getJson(`/api/styles/${encodeURIComponent(name)}`),
  };
}

export function resolveFormaAssetPath(
  assetsRoot: string,
  requestUrl: string,
): { status: 200; path: string } | { status: 403 } {
  if (/(\.\.|%2e%2e)/i.test(requestUrl)) {
    return { status: 403 };
  }

  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { status: 403 };
  }

  let relativePath: string;
  try {
    const hostPath = url.hostname ? `${url.hostname}${url.pathname}` : url.pathname;
    relativePath = decodeURIComponent(hostPath).replace(/^\/+/, "");
  } catch {
    return { status: 403 };
  }

  const root = resolve(assetsRoot);
  const safePath = resolve(root, relativePath);
  if (!isSameOrChildPath(root, safePath)) {
    return { status: 403 };
  }
  return { status: 200, path: safePath };
}

export function createProtocolHandler(assetsRoot: string) {
  return (request: { url: string }): Response => {
    const result = resolveFormaAssetPath(assetsRoot, request.url);
    if (result.status !== 200) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!existsSync(result.path)) {
      return new Response("Not found", { status: 404 });
    }
    // Return file content — real impl uses fs.createReadStream
    return new Response(null, { status: 200 });
  };
}

export async function startMainProcess(): Promise<void> {
  // Dynamic import keeps electron out of the module graph during tests
  const { app, BrowserWindow, ipcMain, protocol } = await import("electron");
  const { createReadStream } = await import("fs");

  assertElectronVersion();
  registerFormaIpcHandlers(ipcMain);

  app.on("ready", () => {
    const assetsRoot = app.getPath("userData");

    protocol.handle("forma-asset", (request) => {
      const result = resolveFormaAssetPath(assetsRoot, request.url);
      if (result.status !== 200) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!existsSync(result.path)) {
        return new Response("Not found", { status: 404 });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Response(createReadStream(result.path) as unknown as any);
    });

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: join(__dirname, "../preload/index.js"),
      },
    });

    win.loadFile(resolveRendererIndexPath(__dirname));
  });
}

function defaultFormaServerBaseUrl(): string {
  if (process.env.FORMA_SERVER_URL) {
    return process.env.FORMA_SERVER_URL.replace(/\/+$/, "");
  }
  const host = process.env.FORMA_SERVER_HOST ?? "127.0.0.1";
  const port = process.env.FORMA_SERVER_PORT ?? String(DEFAULT_FORMA_SERVER_PORT);
  return `http://${host}:${port}`;
}

function absolutizePreviewUrls(value: unknown, baseUrl: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => absolutizePreviewUrls(item, baseUrl));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "preview_url" && typeof item === "string"
        ? absoluteServerUrl(item, baseUrl)
        : absolutizePreviewUrls(item, baseUrl),
    ]),
  );
}

function absoluteServerUrl(value: string, baseUrl: string): string {
  if (/^https?:\/\//u.test(value)) {
    return value;
  }
  return new URL(value, `${baseUrl}/`).toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSameOrChildPath(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return (
    relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function requireIpcString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`FORMA_DESKTOP_INVALID_IPC_ARGUMENT: ${field}`);
  }
  return value;
}

export function shouldStartMainProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["NODE_ENV"] !== "test";
}

// Main entry — only runs when not in test
if (shouldStartMainProcess()) {
  void startMainProcess();
}
