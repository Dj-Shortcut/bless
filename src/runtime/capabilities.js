export function getTerminalCapabilities({ stdin = process.stdin, stdout = process.stdout, env = process.env } = {}) {
  const stdinIsTTY = Boolean(stdin?.isTTY);
  const stdoutIsTTY = Boolean(stdout?.isTTY);
  const hasFullTTY = stdinIsTTY && stdoutIsTTY;
  const hasTTYOutputOnly = !stdinIsTTY && stdoutIsTTY;
  const isDumbTerminal = env?.TERM === "dumb";
  const interactivePager = !isDumbTerminal && (hasFullTTY || hasTTYOutputOnly);

  return {
    stdinIsTTY,
    stdoutIsTTY,
    interactivePager,
    passthrough: !interactivePager
  };
}

export function canUseInteractiveTerminal(options = {}) {
  return getTerminalCapabilities(options).interactivePager;
}
