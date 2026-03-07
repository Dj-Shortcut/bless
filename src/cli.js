import fs from "node:fs";
import { pathToFileURL } from "node:url";

const ALT_SCREEN_ON = "\u001b[?1049h";
const ALT_SCREEN_OFF = "\u001b[?1049l";

export function canUseInteractiveTerminal({ stdin = process.stdin, stdout = process.stdout, env = process.env } = {}) {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  if (env.TERM === "dumb") return false;
  return true;
}

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
    interactive: canUseInteractiveTerminal({ stdin, stdout }),
    interrupted: false
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

  function installHandlers({ onSigint: onSigintCallback } = {}) {
    const supportsResize = typeof stdout.on === "function" && typeof stdout.removeListener === "function";
    let resizeAttached = false;

    let disposed = false;
    const dispose = () => {
      if (disposed) {
        return;
      }
      disposed = true;

      processRef.removeListener("SIGINT", onSigint);
      processRef.removeListener("exit", onExit);
      processRef.removeListener("uncaughtException", onUncaught);
      processRef.removeListener("unhandledRejection", onUncaught);
      if (resizeAttached) {
        stdout.removeListener("resize", printFrame);
      }
    };

    const onSigint = () => {
      dispose();
      state.interrupted = true;
      cleanupAndExit(130);
      onSigintCallback?.();
      if (typeof processRef.exit === "function") {
        processRef.exit(130);
      }
    };
    const onExit = () => {
      dispose();
      restoreTerminal();
    };
    const onUncaught = (error) => {
      dispose();
      writeSafe(stderr, `${error?.stack || error}\n`);
      cleanupAndExit(1);
    };

    processRef.once("SIGINT", onSigint);
    processRef.once("exit", onExit);
    processRef.once("uncaughtException", onUncaught);
    processRef.once("unhandledRejection", onUncaught);

    if (state.interactive && supportsResize) {
      stdout.on("resize", printFrame);
      resizeAttached = true;
    }

    return dispose;
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
