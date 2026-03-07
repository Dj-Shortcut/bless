function padOrTrim(line, width) {
  const text = line.length > width ? line.slice(0, width) : line;
  return text.padEnd(width, " ");
}

export function renderFrame({ interactive, platform, columns, rows, lines = null, topLine = 0, status = "" }) {
  if (!interactive) {
    return "bless (non-interactive mode)\n";
  }

  if (!Array.isArray(lines)) {
    return `bless (${platform}) ${columns || 0}x${rows || 0}\r\n`;
  }

  const width = columns || 80;
  const height = rows || 24;
  const bodyHeight = Math.max(1, height - 1);
  const visibleLines = lines.slice(topLine, topLine + bodyHeight);

  while (visibleLines.length < bodyHeight) {
    visibleLines.push("");
  }

  const statusLine = padOrTrim(status || `bless (${platform})`, width);
  const body = visibleLines.map((line) => padOrTrim(line, width)).join("\r\n");

  return `\u001b[H\u001b[2J${body}\r\n${statusLine}`;
}
