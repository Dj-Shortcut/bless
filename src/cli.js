import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { canUseInteractiveTerminal } from "./runtime/capabilities.js";
import { createRuntime } from "./runtime/terminal.js";

export { canUseInteractiveTerminal, createRuntime };

export async function run(args = [], io = {}) {
  const runtime = createRuntime(io);
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const fileArg = args.find((arg) => !arg.startsWith("-"));
  let cancelRead = null;
  const removeHandlers = runtime.installHandlers({ onSigint: () => cancelRead?.() });

  try {
    if (!fileArg && runtime.state.interactive) {
      runtime.setupInteractiveMode();
    }

    if (fileArg) {
      const content = fs.readFileSync(fileArg, "utf8");
      stdout.write(content);
      return;
    }

    if (!stdin.isTTY) {
      const piped = await new Promise((resolve, reject) => {
        let data = "";
        const onData = (chunk) => {
          data += chunk;
        };
        const onEnd = () => done(resolve, data);
        const onError = (error) => done(reject, error);
        const done = (settle, value) => {
          stdin.removeListener("data", onData);
          stdin.removeListener("end", onEnd);
          stdin.removeListener("error", onError);
          cancelRead = null;
          settle(value);
        };

        cancelRead = () => done(resolve, "");
        stdin.setEncoding("utf8");
        stdin.on("data", onData);
        stdin.once("end", onEnd);
        stdin.once("error", onError);
      });

      if (runtime.state.interrupted) {
        return;
      }

      stdout.write(piped);
      return;
    }

    runtime.printFrame();
  } finally {
    runtime.restoreTerminal();
    removeHandlers();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run(process.argv.slice(2));
}
