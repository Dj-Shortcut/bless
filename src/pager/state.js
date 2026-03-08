export function createPagerState({ interactive = false } = {}) {
  return {
    interactive,
    restored: false,
    interrupted: false,
    usedRawMode: false,
    usedAltScreen: false,
    cursor: { line: 0, column: 0 },
    topLine: 0,
    status: "",
    viewport: {
      columns: 80,
      rows: 24
    },
    search: {
      query: "",
      active: false,
      lastDirection: "forward"
    }
  };
}
