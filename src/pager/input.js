const ESCAPE_SEQUENCES = new Map([
  ["\u001b[A", "up"],
  ["\u001b[B", "down"],
  ["\u001b[5~", "pageUp"],
  ["\u001b[6~", "pageDown"]
]);

export function decodeKeys(chunk) {
  if (!chunk) return [];
  if (ESCAPE_SEQUENCES.has(chunk)) {
    return [ESCAPE_SEQUENCES.get(chunk)];
  }

  const actions = [];
  for (const key of chunk) {
    if (key === "q") actions.push("quit");
    else if (key === "j") actions.push("down");
    else if (key === "k") actions.push("up");
    else if (key === " ") actions.push("pageDown");
    else if (key === "b") actions.push("pageUp");
    else if (key === "g") actions.push("top");
    else if (key === "G") actions.push("bottom");
  }

  return actions;
}
