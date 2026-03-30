# tsk — Go CLI Example

A task manager CLI that works normally for humans and becomes a SLOP provider when invoked with `--slop`.

## Build

```bash
go build -o tsk .
```

## Usage

### Normal mode

```bash
./tsk                          # list pending tasks
./tsk list --all               # include completed
./tsk list --tag work          # filter by tag
./tsk add "Deploy v2" --due tomorrow --tag work
./tsk done 1                   # mark task t-1 complete
./tsk undo 1                   # reopen task t-1
./tsk edit 1 --title "New title"
./tsk delete 1
./tsk notes 1                  # view notes
./tsk notes 1 --set "New notes"
./tsk search "groceries"
./tsk export markdown
```

### SLOP mode

```bash
./tsk --slop
```

Starts an NDJSON stdio provider. Send SLOP messages on stdin, receive responses on stdout.

### Options

- `--file <path>` — use an alternate data file (default: `~/.tsk/tasks.json`)
- `TSK_FILE` env var — same as `--file`

## Seed data

On first run, if `~/.tsk/tasks.json` does not exist, the tool copies `seed.json` (10 sample tasks) to bootstrap the data file.
