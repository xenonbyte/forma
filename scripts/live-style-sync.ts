import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFormaStore, FormaError, type FormaStore, type SyncStatus } from "@xenonbyte/forma-core";
import { formatGenericErrorForLog, sanitizeGenericErrorForLog } from "./smoke-pencil-error.js";

const pollIntervalMs = 2_000;
const maxWaitMs = 5 * 60 * 1_000;
const liveStyleLimit = 2;

async function main(): Promise<void> {
  ensureHomebrewPencilOnPath();

  const home = await mkdtemp(join(tmpdir(), "forma-live-sync-"));
  try {
    const result = await runLiveSync(home);
    console.log("Live style sync OK");
    console.log(`FORMA_HOME=${home}`);
    console.log(`styles_total=${result.lastSync.styles_total}`);
    console.log(`styles_added=${result.lastSync.styles_added}`);
    console.log(`styles_updated=${result.lastSync.styles_updated}`);
    console.log(`styles_failed=${result.lastSync.styles_failed}`);
    console.log(`last_sync.completed_at=${result.lastSync.completed_at}`);
    console.log(`token_preview_style=${result.tokenPreview.styleName}`);
    console.log(`live_style_limit=${liveStyleLimit}`);
  } catch (error) {
    console.error("Live style sync failed");
    console.error(`FORMA_HOME=${home}`);
    printError(error);
    process.exit(1);
  }
}

async function runLiveSync(home: string): Promise<{
  lastSync: NonNullable<Extract<SyncStatus, { status: "idle" }>["last_sync"]>;
  tokenPreview: { styleName: string };
}> {
  const store = await createFormaStore({ home, bundledStylesDir: resolve("styles"), syncStyleLimit: liveStyleLimit });

  const builtInStyles = await store.styles.installBuiltInStyles();
  invariant(builtInStyles.length > 0, "No built-in styles were installed");

  const running = await store.sync.startSync();
  console.log(`sync_task_id=${running.task_id}`);

  const status = await waitForSync(store);
  invariant(status.last_sync, "Sync finished without last_sync metadata");
  invariant(status.last_sync.styles_total > 0, "Sync completed with styles_total=0");
  invariant(status.last_sync.styles_failed === 0, `Sync completed with styles_failed=${status.last_sync.styles_failed}`);

  const [firstStyle] = await store.styles.listStyles();
  invariant(firstStyle, "Sync completed without style metadata");
  return { lastSync: status.last_sync, tokenPreview: { styleName: firstStyle.name } };
}

async function waitForSync(store: FormaStore): Promise<Extract<SyncStatus, { status: "idle" }>> {
  const deadline = Date.now() + maxWaitMs;
  let lastProgress = "";

  while (Date.now() <= deadline) {
    const status = await store.sync.getStatus();
    if (status.status === "idle") {
      return status;
    }
    if (status.status === "failed") {
      const phase = status.error.phase;
      const message = sanitizeGenericErrorForLog(new Error(status.error.message));
      throw new Error(`Sync failed at phase=${phase}: ${message}`);
    }

    const progress = `${status.progress.phase}:${status.progress.current}/${status.progress.total}:${status.progress.current_style ?? ""}`;
    if (progress !== lastProgress) {
      lastProgress = progress;
      console.log(`sync_progress phase=${status.progress.phase} current=${status.progress.current} total=${status.progress.total}`);
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`Sync timed out after ${Math.round(maxWaitMs / 1_000)} seconds`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function ensureHomebrewPencilOnPath(): void {
  const preferredBins = ["/opt/homebrew/bin", "/usr/local/bin"];
  const currentPath = process.env.PATH ?? "";
  const currentEntries = currentPath.length > 0 ? currentPath.split(":") : [];
  const missingBins = preferredBins.filter((entry) => !currentEntries.includes(entry));
  if (missingBins.length > 0) {
    process.env.PATH = [...missingBins, ...currentEntries].join(":");
  }
}

function printError(error: unknown): void {
  if (error instanceof FormaError) {
    console.error(`FormaError ${error.code}: ${error.message}`);
    const details = safeFormaDetails(error.details);
    if (Object.keys(details).length > 0) {
      console.error(`details=${JSON.stringify(details)}`);
    }
    return;
  }

  console.error(formatGenericErrorForLog(error));
}

function safeFormaDetails(details: Record<string, unknown>): Record<string, string | number | boolean> {
  const safeKeys = new Set(["command", "exitCode", "reason", "file", "phase", "status", "format"]);
  return Object.fromEntries(
    Object.entries(details).filter(
      (entry): entry is [string, string | number | boolean] =>
        safeKeys.has(entry[0]) && ["string", "number", "boolean"].includes(typeof entry[1])
    )
  );
}

await main();
