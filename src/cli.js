#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { canUseInteractiveTerminal } from "./runtime/capabilities.js";
import { createRuntime } from "./runtime/terminal.js";
import { createPagerController } from "./pager/controller.js";

export { canUseInteractiveTerminal, createRuntime };

function toLines(content) {
  return content.replace(/\r\n/g, "\n").split("\n");
}

function writeAndDrain(stream, chunk) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.removeListener("drain", onDrain);
      stream.removeListener("error", onError);
    };

    const onDrain = () => {
      cleanup();
      resolve();
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    stream.once("drain", onDrain);
    stream.once("error", onError);

    try {
      if (stream.write(chunk)) {
        cleanup();
        resolve();
      }
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function run(args = [], io = {}) {
  const runtime = createRuntime(io);
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const platform = io.platform ?? process.platform;
  const fileArg = args.find((arg) => !arg.startsWith("-"));
  let cancelRead = null;
  let stopPager = null;
  let redraw = () => runtime.printFrame();
  const removeHandlers = runtime.installHandlers({
    onSigint: () => {
      cancelRead?.();
      stopPager?.();
    },
    onResize: () => redraw()
  });

  try {
    if (fileArg) {
      const content = fs.readFileSync(fileArg, "utf8");

      if (runtime.state.interactive) {
        runtime.setupInteractiveMode();
        if (!runtime.state.interactive) {
          await writeAndDrain(stdout, content);
          return;
        }

        const pager = createPagerController({
          runtime,
          stdin,
          stdout,
          platform,
          lines: toLines(content),
          onWriteFailure: () => runtime.cleanupAndExit(1)
        });

        stopPager = pager.stop;
        redraw = pager.render;
        await pager.run();
        return;
      }

      await writeAndDrain(stdout, content);
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

      if (runtime.state.interactive) {
        runtime.setupInteractiveMode();
        if (!runtime.state.interactive) {
          await writeAndDrain(stdout, piped);
          return;
        }

        const pager = createPagerController({
          runtime,
          stdin,
          stdout,
          platform,
          lines: toLines(piped),
          onWriteFailure: () => runtime.cleanupAndExit(1)
        });

        stopPager = pager.stop;
        redraw = pager.render;
        await pager.run();
        return;
      }

      await writeAndDrain(stdout, piped);
      return;
    }

    if (runtime.state.interactive) {
      runtime.setupInteractiveMode();
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
