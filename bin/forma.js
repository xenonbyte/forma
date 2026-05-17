#!/usr/bin/env node

import { tsImport } from "tsx/esm/api";

const { runCli } = await tsImport("../packages/cli/src/index.ts", import.meta.url);

runCli(process.argv.slice(2));
