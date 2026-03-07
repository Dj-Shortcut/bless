const ESCAPE_SEQUENCES = [
  ["[5~", "pageUp"],
  ["[6~", "pageDown"],
  ["[A", "up"],
  ["[B", "down"]
];

export function decodeKeys(chunk) {
  if (!chunk) return [];

  const actions = [];
  let index = 0;

  while (index < chunk.length) {
    let matched = false;

    for (const [sequence, action] of ESCAPE_SEQUENCES) {
      if (chunk.startsWith(sequence, index)) {
        actions.push(action);
        index += sequence.length;
        matched = true;
        break;
      }
    }

    if (matched) {
      continue;
    }

    const key = chunk[index];
    if (key === "q") actions.push("quit");
    else if (key === "j") actions.push("down");
    else if (key === "k") actions.push("up");
    else if (key === " ") actions.push("pageDown");
    else if (key === "b") actions.push("pageUp");
    else if (key === "g") actions.push("top");
    else if (key === "G") actions.push("bottom");

    index += 1;
  }

  return actions;
}
