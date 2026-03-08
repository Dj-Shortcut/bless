import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { run } from "../src/cli.js";
import { createRuntime } from "../src/runtime/terminal.js";
import { canUseInteractiveTerminal, getTerminalCapabilities } from "../src/runtime/capabilities.js";
import { createPagerState } from "../src/pager/state.js";
import { renderFrame } from "../src/pager/render.js";
import { decodeKeys } from "../src/pager/input.js";
import { moveTopLine } from "../src/pager/navigation.js";

const TEST_ENV = { TERM: "xterm-256color" };

function waitForNextTick() {
  if (typeof globalThis.setImmediate === "function") {
    return new Promise((resolve) => globalThis.setImmediate(resolve));
  }

  return new Promise((resolve) => setTimeout(resolve, 0));
}

class MockStream extends EventEmitter {
  constructor({ isTTY = false, throwOnWriteIncludes = null } = {}) {
    super();
    this.isTTY = isTTY;
    this.columns = 80;
    this.rows = 24;
    this.buffer = "";
    this.rawMode = false;
    this.throwOnWriteIncludes = throwOnWriteIncludes;
  }

  setRawMode(enabled) {
    this.rawMode = enabled;
  }

  setEncoding() {}

  write(chunk) {
    if (this.throwOnWriteIncludes && chunk.includes(this.throwOnWriteIncludes)) {
      throw new Error("mock write failure");
    }
    this.buffer += chunk;
    return true;
  }
}

function createMockProcess() {
  const listeners = new Map();

  const addListener = (event, handler, once = false) => {
    const handlers = listeners.get(event) ?? [];
    handlers.push({ handler, once });
    listeners.set(event, handlers);
  };

  return {
    exitCode: 0,
    exitCalls: [],
    on(event, handler) {
      addListener(event, handler);
    },
    once(event, handler) {
      addListener(event, handler, true);
    },
    removeListener(event, handler) {
      const handlers = listeners.get(event) ?? [];
      if (!handler) {
        listeners.delete(event);
        return;
      }

      const nextHandlers = handlers.filter((entry) => entry.handler !== handler);
      if (nextHandlers.length > 0) {
        listeners.set(event, nextHandlers);
      } else {
        listeners.delete(event);
      }
    },
    emit(event, value) {
      const handlers = [...(listeners.get(event) ?? [])];
      for (const entry of handlers) {
        entry.handler(value);
        if (entry.once) {
          this.removeListener(event, entry.handler);
        }
      }
    },
    listenerCount(event) {
      return (listeners.get(event) ?? []).length;
    },
    exit(code) {
      this.exitCalls.push(code);
    }
  };
}

test("capability checks determine interactive pager mode from TTY input/output", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });

  assert.equal(canUseInteractiveTerminal({ stdin, stdout, env: { TERM: "xterm-256color" } }), true);
  assert.equal(canUseInteractiveTerminal({ stdin, stdout, env: { TERM: "dumb" } }), false);
  assert.equal(canUseInteractiveTerminal({ stdin, stdout, env: null }), true);
  assert.equal(canUseInteractiveTerminal({ stdin: new MockStream({ isTTY: false }), stdout, env: { TERM: "xterm" } }), true);
  assert.equal(canUseInteractiveTerminal({ stdin, stdout: new MockStream({ isTTY: false }), env: { TERM: "xterm" } }), false);
});


test("capability checks expose interactive and passthrough modes", () => {
  const caps = getTerminalCapabilities({
    stdin: new MockStream({ isTTY: false }),
    stdout: new MockStream({ isTTY: true }),
    env: { TERM: "xterm-256color" }
  });

  assert.equal(caps.stdinIsTTY, false);
  assert.equal(caps.stdoutIsTTY, true);
  assert.equal(caps.interactivePager, true);
  assert.equal(caps.passthrough, false);
});

test("createRuntime tolerates null env without throwing", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });

  assert.doesNotThrow(() => createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef: createMockProcess(), env: null }));
});

test("pager state includes navigation and search placeholders", () => {
  const state = createPagerState({ interactive: true });

  assert.equal(state.interactive, true);
  assert.deepEqual(state.cursor, { line: 0, column: 0 });
  assert.equal(state.topLine, 0);
  assert.deepEqual(state.viewport, { columns: 80, rows: 24 });
  assert.deepEqual(state.search, { query: "", active: false, lastDirection: "forward" });
});

test("render frame shell matches interactive and non-interactive modes", () => {
  assert.equal(renderFrame({ interactive: false, platform: "linux" }), "bless (non-interactive mode)\n");
  assert.equal(renderFrame({ interactive: true, platform: "linux", columns: 100, rows: 40 }), "bless (linux) 100x40\r\n");
});

test("renderFrame supports viewport content", () => {
  const out = renderFrame({
    interactive: true,
    platform: "linux",
    columns: 8,
    rows: 3,
    lines: ["alpha", "bravo", "charlie"],
    topLine: 1,
    status: "q quit"
  });

  assert.match(out, /\u001b\[H\u001b\[2J/);
  assert.match(out, /bravo/);
  assert.match(out, /charlie/);
  assert.match(out, /q quit/);
});

test("decodeKeys maps classic and escape keybindings", () => {
  assert.deepEqual(decodeKeys("j k"), ["down", "pageDown", "up"]);
  assert.deepEqual(decodeKeys("gGq"), ["top", "bottom", "quit"]);
  assert.deepEqual(decodeKeys("\u001b[A"), ["up"]);
  assert.deepEqual(decodeKeys("\u001b[6~"), ["pageDown"]);
});

test("moveTopLine clamps navigation within bounds", () => {
  assert.equal(moveTopLine({ topLine: 0, action: "up", pageSize: 5, totalLines: 10 }), 0);
  assert.equal(moveTopLine({ topLine: 2, action: "down", pageSize: 5, totalLines: 10 }), 3);
  assert.equal(moveTopLine({ topLine: 7, action: "pageDown", pageSize: 5, totalLines: 10 }), 5);
  assert.equal(moveTopLine({ topLine: 3, action: "bottom", pageSize: 5, totalLines: 10 }), 5);
});

test("interactive mode enables and restores raw mode + alt screen", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef: createMockProcess(), env: TEST_ENV });

  runtime.setupInteractiveMode();
  assert.equal(stdin.rawMode, true);
  assert.match(stdout.buffer, /\u001b\[\?1049h/);

  runtime.restoreTerminal();
  assert.equal(stdin.rawMode, false);
  assert.match(stdout.buffer, /\u001b\[\?1049l/);
});

test("restoreTerminal is idempotent", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef: createMockProcess(), env: TEST_ENV });

  runtime.setupInteractiveMode();
  runtime.restoreTerminal();
  runtime.restoreTerminal();

  assert.equal(stdout.buffer.match(/\u001b\[\?1049l/g)?.length, 1);
});

test("non-interactive mode does not use raw mode or alt screen", () => {
  const stdin = new MockStream({ isTTY: false });
  const stdout = new MockStream({ isTTY: false });
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: false }), processRef: createMockProcess() });

  runtime.setupInteractiveMode();
  runtime.printFrame();

  assert.equal(stdin.rawMode, false);
  assert.doesNotMatch(stdout.buffer, /\u001b\[\?1049h/);
  assert.match(stdout.buffer, /non-interactive mode/);
});

test("SIGINT cleanup restores terminal, sets exit code 130, and exits", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const processRef = createMockProcess();
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef, env: TEST_ENV });

  runtime.setupInteractiveMode();
  runtime.installHandlers();
  processRef.emit("SIGINT");

  assert.equal(processRef.exitCode, 130);
  assert.deepEqual(processRef.exitCalls, [130]);
  assert.equal(stdin.rawMode, false);
  assert.match(stdout.buffer, /\u001b\[\?1049l/);
});

test("SIGWINCH handler redraws custom callback in interactive mode", async () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const processRef = createMockProcess();
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef, platform: "win32", env: TEST_ENV });
  let redrawCount = 0;

  runtime.installHandlers({ onResize: () => {
    redrawCount += 1;
    stdout.write("redraw\n");
  } });
  stdout.columns = 61;
  stdout.rows = 12;
  processRef.emit("SIGWINCH");
  processRef.emit("SIGWINCH");

  await waitForNextTick();

  assert.equal(redrawCount, 1);
  assert.match(stdout.buffer, /redraw/);
  assert.deepEqual(runtime.state.viewport, { columns: 61, rows: 12 });
});

test("handler dispose detaches SIGWINCH listener", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const processRef = createMockProcess();
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef, env: TEST_ENV });

  const removeHandlers = runtime.installHandlers();
  assert.equal(processRef.listenerCount("SIGWINCH"), 1);

  removeHandlers();
  assert.equal(processRef.listenerCount("SIGWINCH"), 0);
});

test("SIGINT teardown removes SIGWINCH listener", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const processRef = createMockProcess();
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef, env: TEST_ENV });

  runtime.installHandlers();
  assert.equal(processRef.listenerCount("SIGWINCH"), 1);

  processRef.emit("SIGINT");
  assert.equal(processRef.listenerCount("SIGWINCH"), 0);
});

test("windows console input failure falls back without crash", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  stdin.setRawMode = () => {
    throw new Error("UNKNOWN: unknown error, open '\\\\.\\CONIN$'");
  };

  const runtime = createRuntime({
    stdin,
    stdout,
    stderr: new MockStream({ isTTY: true }),
    processRef: createMockProcess(),
    platform: "win32",
    env: TEST_ENV
  });

  assert.doesNotThrow(() => runtime.setupInteractiveMode());
  assert.equal(runtime.state.interactive, false);
  assert.equal(stdout.buffer.includes("\u001b[?1049h"), false);
});



test("uncaughtException handler prints error and restores terminal", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const stderr = new MockStream({ isTTY: true });
  const processRef = createMockProcess();
  const runtime = createRuntime({ stdin, stdout, stderr, processRef, env: TEST_ENV });

  runtime.setupInteractiveMode();
  runtime.installHandlers();
  processRef.emit("uncaughtException", new Error("boom"));

  assert.equal(processRef.exitCode, 1);
  assert.match(stderr.buffer, /boom/);
  assert.equal(stdin.rawMode, false);
  assert.match(stdout.buffer, /\u001b\[\?1049l/);
});

test("unhandledRejection handler prints reason and restores terminal", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const stderr = new MockStream({ isTTY: true });
  const processRef = createMockProcess();
  const runtime = createRuntime({ stdin, stdout, stderr, processRef, env: TEST_ENV });

  runtime.setupInteractiveMode();
  runtime.installHandlers();
  processRef.emit("unhandledRejection", "reject-reason");

  assert.equal(processRef.exitCode, 1);
  assert.match(stderr.buffer, /reject-reason/);
  assert.equal(stdin.rawMode, false);
  assert.match(stdout.buffer, /\u001b\[\?1049l/);
});

test("run reads piped input from provided stdin stream", async () => {
  const stdin = new MockStream({ isTTY: false });
  const stdout = new MockStream({ isTTY: false });

  process.nextTick(() => {
    stdin.emit("data", "piped-content\n");
    stdin.emit("end");
  });

  await run([], { stdin, stdout, stderr: new MockStream({ isTTY: false }), processRef: createMockProcess() });
  assert.equal(stdout.buffer, "piped-content\n");
});


test("run with piped input starts pager when stdout is a TTY", async () => {
  const stdin = new MockStream({ isTTY: false });
  const stdout = new MockStream({ isTTY: true });
  stdout.rows = 3;
  stdout.columns = 20;

  const runPromise = run([], {
    stdin,
    stdout,
    stderr: new MockStream({ isTTY: true }),
    processRef: createMockProcess(),
    env: TEST_ENV,
    platform: "linux"
  });

  process.nextTick(() => {
    stdin.emit("data", "line1\nline2\n");
    stdin.emit("end");
  });

  setTimeout(() => {
    stdin.emit("data", "q");
  }, 0);

  await runPromise;

  assert.match(stdout.buffer, /line1/);
  assert.match(stdout.buffer, /q quit/);
  assert.match(stdout.buffer, /\[\?1049h/);
  assert.match(stdout.buffer, /\[\?1049l/);
});



test("run with file input uses passthrough when stdout is not a TTY", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bless-test-"));
  const filePath = path.join(dir, "input.txt");
  fs.writeFileSync(filePath, "file-content\n", "utf8");

  try {
    const stdin = new MockStream({ isTTY: true });
    const stdout = new MockStream({ isTTY: false });

    await run([filePath], { stdin, stdout, stderr: new MockStream({ isTTY: false }), processRef: createMockProcess(), env: TEST_ENV });

    assert.equal(stdout.buffer, "file-content\n");
    assert.equal(stdout.buffer.includes("[?1049h"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run with file input remains passthrough in non-interactive mode", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bless-test-"));
  const filePath = path.join(dir, "input.txt");
  fs.writeFileSync(filePath, "file-content\n", "utf8");

  try {
    const stdin = new MockStream({ isTTY: false });
    const stdout = new MockStream({ isTTY: false });

    await run([filePath], { stdin, stdout, stderr: new MockStream({ isTTY: false }), processRef: createMockProcess() });

    assert.equal(stdout.buffer, "file-content\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("run propagates async stdout errors while waiting for drain", async () => {
  class BackpressureErrorStream extends MockStream {
    write(chunk) {
      this.buffer += chunk;
      process.nextTick(() => this.emit("error", new Error("mock async write failure")));
      return false;
    }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bless-test-"));
  const filePath = path.join(dir, "input.txt");
  fs.writeFileSync(filePath, "file-content\n", "utf8");

  try {
    const stdin = new MockStream({ isTTY: false });
    const stdout = new BackpressureErrorStream({ isTTY: false });

    await assert.rejects(
      run([filePath], { stdin, stdout, stderr: new MockStream({ isTTY: false }), processRef: createMockProcess() }),
      /mock async write failure/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});



test("run exits cleanly when pager frame write fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bless-test-"));
  const filePath = path.join(dir, "input.txt");
  fs.writeFileSync(filePath, "line1\nline2\n", "utf8");

  try {
    const stdin = new MockStream({ isTTY: true });
    const stdout = new MockStream({ isTTY: true, throwOnWriteIncludes: "\u001b[H\u001b[2J" });

    await run([filePath], {
      stdin,
      stdout,
      stderr: new MockStream({ isTTY: true }),
      processRef: createMockProcess(),
      env: TEST_ENV,
      platform: "linux"
    });

    assert.equal(stdin.listenerCount("data"), 0);
    assert.equal(stdin.listenerCount("end"), 0);
    assert.match(stdout.buffer, /\u001b\[\?1049h/);
    assert.match(stdout.buffer, /\u001b\[\?1049l/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run with interactive file input starts pager and quits with q", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bless-test-"));
  const filePath = path.join(dir, "input.txt");
  fs.writeFileSync(filePath, "line1\nline2\nline3\nline4\n", "utf8");

  try {
    const stdin = new MockStream({ isTTY: true });
    const stdout = new MockStream({ isTTY: true });
    stdout.rows = 3;
    stdout.columns = 20;

    const runPromise = run([filePath], {
      stdin,
      stdout,
      stderr: new MockStream({ isTTY: true }),
      processRef: createMockProcess(),
      env: TEST_ENV,
      platform: "linux"
    });

    process.nextTick(() => {
      stdin.emit("data", " ");
      stdin.emit("data", "q");
    });

    await runPromise;

    assert.match(stdout.buffer, /line1/);
    assert.match(stdout.buffer, /q quit/);
    assert.match(stdout.buffer, /\u001b\[\?1049h/);
    assert.match(stdout.buffer, /\u001b\[\?1049l/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run cancels piped read on SIGINT", async () => {
  const stdin = new MockStream({ isTTY: false });
  const stdout = new MockStream({ isTTY: false });
  const processRef = createMockProcess();

  const runPromise = run([], { stdin, stdout, stderr: new MockStream({ isTTY: false }), processRef });

  process.nextTick(() => {
    processRef.emit("SIGINT");
  });

  await runPromise;

  assert.equal(processRef.exitCode, 130);
  assert.deepEqual(processRef.exitCalls, [130]);
  assert.equal(stdout.buffer, "");
});
