import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { createRuntime, run } from "../src/cli.js";

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
    once(event, handler) {
      listeners.set(event, handler);
    },
    removeListener(event) {
      listeners.delete(event);
    },
    emit(event, value) {
      const handler = listeners.get(event);
      if (handler) {
        handler(value);
      }
    }
  };
}

test("interactive mode enables and restores raw mode + alt screen", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef: createMockProcess() });

  runtime.setupInteractiveMode();
  assert.equal(stdin.rawMode, true);
  assert.match(stdout.buffer, /\u001b\[\?1049h/);

  runtime.restoreTerminal();
  assert.equal(stdin.rawMode, false);
  assert.match(stdout.buffer, /\u001b\[\?1049l/);
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

test("SIGINT cleanup restores terminal and sets exit code 130", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const processRef = createMockProcess();
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef });

  runtime.setupInteractiveMode();
  runtime.installHandlers();
  processRef.emit("SIGINT");

  assert.equal(processRef.exitCode, 130);
  assert.equal(stdin.rawMode, false);
  assert.match(stdout.buffer, /\u001b\[\?1049l/);
});

test("resize handler redraws frame in interactive mode", () => {
  const stdin = new MockStream({ isTTY: true });
  const stdout = new MockStream({ isTTY: true });
  const runtime = createRuntime({ stdin, stdout, stderr: new MockStream({ isTTY: true }), processRef: createMockProcess(), platform: "win32" });

  runtime.installHandlers();
  stdout.emit("resize");

  assert.match(stdout.buffer, /bless \(win32\)/);
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
    platform: "win32"
  });

  assert.doesNotThrow(() => runtime.setupInteractiveMode());
  assert.equal(runtime.state.interactive, false);
  assert.equal(stdout.buffer.includes("\u001b[?1049h"), false);
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
