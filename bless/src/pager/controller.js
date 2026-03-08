import { decodeKeys } from "./input.js";
import { moveTopLine } from "./navigation.js";
import { renderFrame } from "./render.js";

function getPageSize(stdout) {
  return Math.max(1, (stdout.rows || 24) - 1);
}

function writeFrameSafe(stdout, frame) {
  try {
    stdout.write(frame);
    return true;
  } catch {
    return false;
  }
}

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

  return writeFrameSafe(stdout, frame);
}

export function createPagerController({ runtime, stdin, stdout, platform, lines, onWriteFailure = null }) {
  const clampTopLine = () => {
    const pageSize = getPageSize(stdout);
    runtime.state.topLine = Math.max(0, Math.min(runtime.state.topLine, lines.length - pageSize));
  };

  const render = () => {
    clampTopLine();
    runtime.state.status = `q quit | ${runtime.state.topLine + 1}/${Math.max(1, lines.length)}`;
    if (!renderPagerFrame({ runtime, stdout, platform, lines })) {
      onWriteFailure?.();
      finish();
      return false;
    }

    return true;
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

      const pageSize = getPageSize(stdout);
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
