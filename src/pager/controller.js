import { decodeKeys } from "./input.js";
import { moveTopLine } from "./navigation.js";
import { renderFrame } from "./render.js";

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
  const getPageSize = () => Math.max(1, (stdout.rows || 24) - 1);
  const clampTopLine = () => {
    const pageSize = getPageSize();
    const maxTop = Math.max(0, lines.length - pageSize);
    runtime.state.topLine = Math.max(0, Math.min(runtime.state.topLine, maxTop));
  };

  const render = () => {
    clampTopLine();
<<<<<<< HEAD
    runtime.state.status = `q quit · ${runtime.state.topLine + 1}/${Math.max(1, lines.length)}`;
=======
    runtime.state.status = `q quit | ${runtime.state.topLine + 1}/${Math.max(1, lines.length)}`;
>>>>>>> 05d96cf (Document pager controls keys)
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

      runtime.state.topLine = moveTopLine({
        topLine: runtime.state.topLine,
        action,
        pageSize: getPageSize(),
<<<<<<< HEAD
        pageSize,
=======
>>>>>>> 05d96cf (Document pager controls keys)
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
