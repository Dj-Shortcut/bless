import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cliPath = path.resolve("src/cli.js");

function spawnBless(args, { stdinData } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.once("error", reject);

    if (stdinData !== undefined) {
      child.stdin.end(stdinData);
    } else {
      child.stdin.end();
    }

    child.once("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks)
      });
    });
  });
}

test("CLI preserves full bytes when writing large file output to piped stdout", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bless-pipe-test-"));
  const filePath = path.join(dir, "big-input.txt");
  const expected = Buffer.from(("0123456789abcdef\n").repeat(700_000), "utf8");
  fs.writeFileSync(filePath, expected);

  try {
    const result = await spawnBless([filePath]);

    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr.length, 0);
    assert.equal(result.stdout.equals(expected), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI preserves full bytes for large piped stdin passthrough", async () => {
  const expected = Buffer.from(("piped-line\n").repeat(800_000), "utf8");
  const result = await spawnBless([], { stdinData: expected });

  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr.length, 0);
  assert.equal(result.stdout.equals(expected), true);
});
