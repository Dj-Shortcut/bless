import { decodeKeys } from "./input.js";
import { moveTopLine } from "./navigation.js";
import { renderFrame } from "./render.js";

export function renderPagerFrame({ runtime, stdout, platform, lines }) {
  const frame = renderFrame({
    interactive: true,
    platform,
    columns: stdout.columns,
    rows: stdout.rows,
    lines,
    topLine: runtime.state.topLine,
    status: runtime.state.status
  });
  stdout.write(frame);
}

export function createPagerController({ runtime, stdin, stdout, platform, lines }) {
  const pageSize = Math.max(1, (stdout.rows || 24) - 1);

  const render = () => {
    runtime.state.status = `q quit · ${runtime.state.topLine + 1}/${Math.max(1, lines.length)}`;
    renderPagerFrame({ runtime, stdout, platform, lines });
  };

  let done = false;
  let resolveDone;

  const finish = () => {
    if (done) return;
    done = true;
    stdin.removeListener("data", onData);
    stdin.removeListener("end", finish);
    resolveDone?.();
  };

  const onData = (chunk) => {
    for (const action of decodeKeys(chunk)) {
      if (action === "quit") {
        finish();
        return;
      }

      runtime.state.topLine = moveTopLine({
        topLine: runtime.state.topLine,
        action,
        pageSize,
        totalLines: lines.length
      });
    }

    render();
  };

  return {
    render,
    stop: finish,
    run() {
      return new Promise((resolve) => {
        resolveDone = resolve;
        stdin.setEncoding("utf8");
        stdin.on("data", onData);
        stdin.once("end", finish);
        render();
      });
    }
  };
}
