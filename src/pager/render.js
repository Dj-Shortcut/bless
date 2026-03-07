export function renderFrame({ interactive, platform, columns, rows }) {
  if (interactive) {
    return `bless (${platform}) ${columns || 0}x${rows || 0}\r\n`;
  }

  return "bless (non-interactive mode)\n";
}
