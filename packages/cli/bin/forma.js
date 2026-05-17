#!/usr/bin/env node

async function loadCli() {
  try {
    return await import("../dist/index.js");
  } catch (error) {
    if (
      error?.code !== "ERR_MODULE_NOT_FOUND" ||
      !error?.url?.endsWith("/packages/cli/dist/index.js")
    ) {
      throw error;
    }

    const { tsImport } = await import("tsx/esm/api");
    return await tsImport("../src/index.ts", import.meta.url);
  }
}

const { runCli } = await loadCli();

runCli(process.argv.slice(2));
