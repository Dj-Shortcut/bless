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
  const normalizedEnv = env ?? process.env;
  const state = createPagerState({ interactive: canUseInteractiveTerminal({ stdin, stdout, env: normalizedEnv }) });

  function updateViewport() {
    state.viewport.columns = Math.max(1, stdout.columns || 80);
    state.viewport.rows = Math.max(1, stdout.rows || 24);
  }

  updateViewport();

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
      // Windows can fail opening console input (e.g. \\.\\CONIN$) even when stdout is a TTY.
      // Fall back to non-interactive mode instead of crashing.
      state.interactive = false;
      return;
    }

    writeSafe(stdout, ALT_SCREEN_ON);
    state.usedAltScreen = true;
  }

  function printFrame() {
    updateViewport();
    writeSafe(
      stdout,
      renderFrame({
        interactive: state.interactive,
        platform,
        columns: state.viewport.columns,
        rows: state.viewport.rows
      })
    );
  }

  function cleanupAndExit(code = 0) {
    restoreTerminal();
    processRef.exitCode = code;
  }

  function installHandlers({ onSigint: onSigintCallback, onResize = printFrame } = {}) {
    let resizeScheduled = false;
    const runResize = () => {
      resizeScheduled = false;
      if (disposed) {
        return;
      }
      updateViewport();
      onResize?.();
    };
    const resizeHandler = () => {
      if (resizeScheduled) {
        return;
      }
      resizeScheduled = true;
      setImmediate(runResize);
    };
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
        processRef.removeListener("SIGWINCH", resizeHandler);
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

    if (state.interactive && typeof processRef.on === "function" && typeof processRef.removeListener === "function") {
      processRef.on("SIGWINCH", resizeHandler);
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
    installHandlers,
    updateViewport
  };
}
