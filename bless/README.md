# bless

`bless` is a terminal-first CLI.

## Development

```bash
npm install
npm test
```

## Test suite

Bless focuses heavily on terminal correctness:

- raw mode restoration
- SIGINT cleanup
- piped input behavior
- Windows console fallback
  
<img width="1920" height="1050" alt="image" src="https://github.com/user-attachments/assets/9402692f-e907-4a45-91b5-b06a5f9ff77f" />



## Local install

```bash
npm link
printf 'hello from bless\n' | bless
```

## Basic interactive pager controls

When viewing a file in an interactive TTY, `bless` now supports a minimal pager loop with classic keys:

- `q` quit
- `j`/`k` and `Up`/`Down` move one line
- `space`/`b` and `PgDn`/`PgUp` page down/up
- `g`/`G` jump to top/bottom

## Known limitations

- Full-screen behavior (alternate screen + resize) requires an interactive TTY.
- File viewing still loads the full file into memory; chunked large-file buffering is not implemented yet.
- Search (`/`, `n`, `N`) is not implemented yet.
- In non-interactive environments, `bless` reads stdin and echoes it back.
- On Windows, piped stdin can also fall back to plain output when `bless` cannot acquire interactive console input (for example `\\.\\CONIN$` open failures).
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
