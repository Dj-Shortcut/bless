export function canUseInteractiveTerminal({ stdin = process.stdin, stdout = process.stdout, env = process.env } = {}) {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  if (env.TERM === "dumb") return false;
  return true;
}
