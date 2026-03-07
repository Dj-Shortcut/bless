import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { run } from "../src/cli.js";
import { createRuntime } from "../src/runtime/terminal.js";
import { canUseInteractiveTerminal } from "../src/runtime/capabilities.js";
import { createPagerState } from "../src/pager/state.js";
import { renderFrame } from "../src/pager/render.js";

const TEST_ENV = { TERM: "xterm-256color" };

class MockStream extends EventEmitter {
  constructor({ isTTY = false } = {}) {
    super();
    this.isTTY = isTTY;
    this.columns = 80;
    this.rows = 24;
    this.buffer = "";
    this.rawMode = false;
  }

  setRawMode(enabled) {
    this.rawMode = enabled;
  }

  setEncoding() {}

  write(chunk) {
    this.buffer += chunk;
  }
}

function createMockProcess() {
  const listeners = new Map();
  return {
    exitCode: 0,
    exitCalls: [],
    once(event, handler) {
      listeners.set(event, handler);
    },
    removeListener(event, handler) {
      const current = listeners.get(event);
      if (!handler || current === handler) {
        listeners.delete(event);
      }
    },
    emit(event, value) {
      const handler = listeners.get(event);
      if (handler) {
        listeners.delete(event);
        handler(value);
      }
    },
    exit(code) {
      this.exitCalls.push(code);
    }
  };
}

test("capability checks require TTYs and non-dumb terminal", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });

  assert.equal(canUseInteractiveTerminal({ stdin, stdout, env: { TERM: "xterm-256color" } }), true);
  assert.equal(canUseInteractiveTerminal({ stdin, stdout, env: { TERM: "dumb" } }), false);
  assert.equal(canUseInteractiveTerminal({ stdin, stdout, env: null }), true);
  assert.equal(canUseInteractiveTerminal({ stdin: new MockStream(), stdout, env: { TERM: "xterm" } }), false);
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
  assert.deepEqual(state.search, { query: "", active: false, lastDirection: "forward" });
});

test("render frame shell matches interactive and non-interactive modes", () => {
  assert.equal(renderFrame({ interactive: false, platform: "linux" }), "bless (non-interactive mode)\n");
  assert.equal(renderFrame({ interactive: true, platform: "linux", columns: 100, rows: 40 }), "bless (linux) 100x40\r\n");
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

test("resize handler redraws frame in interactive mode", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef: createMockProcess(), platform: "win32", env: TEST_ENV });

  runtime.installHandlers();
  stdout.emit("resize");

  assert.match(stdout.buffer, /bless \(win32\)/);
});

test("handler dispose detaches resize listener", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const processRef = createMockProcess();
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef, env: TEST_ENV });

  const removeHandlers = runtime.installHandlers();
  assert.equal(stdout.listenerCount("resize"), 1);

  removeHandlers();
  assert.equal(stdout.listenerCount("resize"), 0);
});

test("SIGINT teardown removes resize listener", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const processRef = createMockProcess();
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef, env: TEST_ENV });

  runtime.installHandlers();
  assert.equal(stdout.listenerCount("resize"), 1);

  processRef.emit("SIGINT");
  assert.equal(stdout.listenerCount("resize"), 0);
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

test("run with file input bypasses interactive pager setup", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bless-test-"));
  const filePath = path.join(dir, "input.txt");
  fs.writeFileSync(filePath, "file-content\n", "utf8");

  try {
    const stdin = new MockStream({ isTTY: true });
    const stdout = new MockStream({ isTTY: true });

    await run([filePath], { stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef: createMockProcess() });

    assert.equal(stdout.buffer, "file-content\n");
    assert.equal(stdin.rawMode, false);
    assert.equal(stdout.buffer.includes("\u001b[?1049h"), false);
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
