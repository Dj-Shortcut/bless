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
printf 'hello from bless\n' | bless
```

## Known limitations

- Full-screen behavior (alternate screen + resize) requires an interactive TTY.
- In non-interactive environments, `bless` reads stdin and echoes it back.
- `bless` currently has no built-in `--help` or `--version` output.
- Windows terminal behavior depends on the host terminal supporting ANSI control sequences.
- When both a filename and piped stdin are provided, the filename is preferred.
- Unexpected runtime failures still attempt cleanup, but if the process is forcibly killed (e.g. SIGKILL), terminal restoration is not possible.

## Release-readiness checklist (packaging)

```bash
npm test
npm pack --dry-run
npm link
printf 'link check\n' | bless
npm install -g .
printf 'global check\n' | bless
git ls-files --eol
```
