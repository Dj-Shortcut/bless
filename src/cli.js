import fs from "node:fs";
import { pathToFileURL } from "node:url";

const ALT_SCREEN_ON = "\u001b[?1049h";
const ALT_SCREEN_OFF = "\u001b[?1049l";

export function createRuntime({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  platform = process.platform,
  processRef = process
} = {}) {
  const state = {
    usedRawMode: false,
    usedAltScreen: false,
    restored: false,
    interactive: Boolean(stdin.isTTY && stdout.isTTY)
  };

  function writeSafe(stream, chunk) {
    try {
      stream.write(chunk);
    } catch {
      // ignore write failures during shutdown
    }
  }

  function restoreTerminal() {
    if (state.restored) {
      return;
    }
    state.restored = true;

    if (state.usedRawMode && typeof stdin.setRawMode === "function") {
      try {
        stdin.setRawMode(false);
      } catch {
        // no-op
      }
    }

    if (state.usedAltScreen) {
      writeSafe(stdout, ALT_SCREEN_OFF);
    }
  }

  function setupInteractiveMode() {
    if (!state.interactive || typeof stdin.setRawMode !== "function") {
      return;
    }

    try {
      stdin.setRawMode(true);
      state.usedRawMode = true;
    } catch {
      // Windows can fail opening console input (e.g. \\.\CONIN$) even when stdout is a TTY.
      // Fall back to non-interactive mode instead of crashing.
      state.interactive = false;
      return;
    }

    writeSafe(stdout, ALT_SCREEN_ON);
    state.usedAltScreen = true;
  }

  function canHandleResize() {
    return state.interactive && typeof stdout.on === "function" && typeof stdout.removeListener === "function";
  }

  function printFrame() {
    if (state.interactive) {
      writeSafe(stdout, `bless (${platform}) ${stdout.columns || 0}x${stdout.rows || 0}\r\n`);
      return;
    }

    writeSafe(stdout, "bless (non-interactive mode)\n");
  }

  function cleanupAndExit(code = 0) {
    restoreTerminal();
    processRef.exitCode = code;
  }

  function installHandlers() {
    const onSigint = () => cleanupAndExit(130);
    const onExit = () => restoreTerminal();
    const onUncaught = (error) => {
      writeSafe(stderr, `${error?.stack || error}\n`);
      cleanupAndExit(1);
    };

    processRef.once("SIGINT", onSigint);
    processRef.once("exit", onExit);
    processRef.once("uncaughtException", onUncaught);
    processRef.once("unhandledRejection", onUncaught);

    if (canHandleResize()) {
      stdout.on("resize", printFrame);
    }

    return () => {
      processRef.removeListener("SIGINT", onSigint);
      processRef.removeListener("exit", onExit);
      processRef.removeListener("uncaughtException", onUncaught);
      processRef.removeListener("unhandledRejection", onUncaught);
      if (canHandleResize()) {
        stdout.removeListener("resize", printFrame);
      }
    };
  }

  return {
    state,
    setupInteractiveMode,
    restoreTerminal,
    printFrame,
    cleanupAndExit,
    installHandlers
  };
}

export async function run(args = [], io = {}) {
  const runtime = createRuntime(io);
  const removeHandlers = runtime.installHandlers();
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;

  try {
    runtime.setupInteractiveMode();

    const fileArg = args.find((arg) => !arg.startsWith("-"));
    if (fileArg) {
      const content = fs.readFileSync(fileArg, "utf8");
      stdout.write(content);
      return;
    }

    if (!stdin.isTTY) {
      const piped = await new Promise((resolve, reject) => {
        let data = "";
        stdin.setEncoding("utf8");
        stdin.on("data", (chunk) => {
          data += chunk;
        });
        stdin.once("end", () => resolve(data));
        stdin.once("error", reject);
      });
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
