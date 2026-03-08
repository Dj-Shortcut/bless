import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, "../src");

const files = {
  "cli.js": `#!/usr/bin/env node\nimport { pathToFileURL } from \"node:url\";\n\nimport { run } from \"../../src/cli.js\";\n\nexport { canUseInteractiveTerminal, createRuntime, run } from \"../../src/cli.js\";\n\nif (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {\n  await run(process.argv.slice(2));\n}\n`,
  "pager/controller.js": 'export * from "../../../src/pager/controller.js";\n',
  "pager/input.js": 'export * from "../../../src/pager/input.js";\n',
  "pager/navigation.js": 'export * from "../../../src/pager/navigation.js";\n',
  "pager/render.js": 'export * from "../../../src/pager/render.js";\n',
  "pager/state.js": 'export * from "../../../src/pager/state.js";\n',
  "runtime/capabilities.js": 'export * from "../../../src/runtime/capabilities.js";\n',
  "runtime/terminal.js": 'export * from "../../../src/runtime/terminal.js";\n'
};

for (const [relPath, content] of Object.entries(files)) {
  const filePath = path.join(srcDir, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  if (relPath === "cli.js") {
    fs.chmodSync(filePath, 0o644);
  }
}

