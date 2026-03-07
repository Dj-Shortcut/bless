# bless

`bless` is a terminal-first CLI.

## Development

```bash
npm install
npm test
```

## Local install

```bash
npm link
bless --help
```

## Known limitations

- Full-screen behavior (alternate screen + resize) requires an interactive TTY.
- In non-interactive environments, `bless` runs in line mode and skips raw-mode terminal features.
- Windows terminal behavior depends on the host terminal supporting ANSI control sequences.
- When both a filename and piped stdin are provided, the filename is preferred.
- Unexpected runtime failures still attempt cleanup, but if the process is forcibly killed (e.g. SIGKILL), terminal restoration is not possible.
