#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { run } from "../../src/cli.js";

export { canUseInteractiveTerminal, createRuntime, run } from "../../src/cli.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run(process.argv.slice(2));
}
