import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cliPath = path.resolve("src/cli.js");

test("CLI child process preserves full bytes when stdout is piped", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bless-pipe-test-"));
  const inputPath = path.join(dir, "input.txt");
  const outputPath = path.join(dir, "output.txt");
  const expected = Buffer.from(("pipe-check-line\n").repeat(300_000), "utf8");

  fs.writeFileSync(inputPath, expected);

  try {
    const child = spawn(process.execPath, [cliPath, inputPath], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const outputStream = fs.createWriteStream(outputPath);
    const stderrChunks = [];

    child.stdout.pipe(outputStream);
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    await Promise.all([
      new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => {
          if (code !== 0 || signal !== null) {
            reject(new Error(`Unexpected child exit: code=${code} signal=${signal}`));
            return;
          }
          resolve();
        });
      }),
      new Promise((resolve, reject) => {
        outputStream.once("error", reject);
        outputStream.once("finish", resolve);
      })
    ]);

    const actual = fs.readFileSync(outputPath);
    const stderr = Buffer.concat(stderrChunks);

    assert.equal(stderr.length, 0);
    assert.equal(actual.equals(expected), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
