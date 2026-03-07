function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function moveTopLine({ topLine, action, pageSize, totalLines }) {
  const maxTop = Math.max(0, totalLines - pageSize);

  if (action === "down") return clamp(topLine + 1, 0, maxTop);
  if (action === "up") return clamp(topLine - 1, 0, maxTop);
  if (action === "pageDown") return clamp(topLine + pageSize, 0, maxTop);
  if (action === "pageUp") return clamp(topLine - pageSize, 0, maxTop);
  if (action === "top") return 0;
  if (action === "bottom") return maxTop;

  return topLine;
}
