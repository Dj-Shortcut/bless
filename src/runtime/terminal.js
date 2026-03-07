import { canUseInteractiveTerminal } from "./capabilities.js";
import { createPagerState } from "../pager/state.js";
import { renderFrame } from "../pager/render.js";

const ALT_SCREEN_ON = "\u001b[?1049h";
const ALT_SCREEN_OFF = "\u001b[?1049l";

export function createRuntime({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  platform = process.platform,
  processRef = process,
  env = process.env
} = {}) {
  const state = createPagerState({ interactive: canUseInteractiveTerminal({ stdin, stdout, env }) });

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
      state.interactive = false;
      return;
    }

    writeSafe(stdout, ALT_SCREEN_ON);
    state.usedAltScreen = true;
  }

  function printFrame() {
    writeSafe(
      stdout,
      renderFrame({
        interactive: state.interactive,
        platform,
        columns: stdout.columns,
        rows: stdout.rows
      })
    );
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
