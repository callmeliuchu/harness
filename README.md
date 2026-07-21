# pycodex-core

A small, headless coding-agent core. It uses the OpenAI-compatible DeepSeek endpoint configured in `~/.claude/settings.json` and deliberately has no TUI.

## Run

```bash
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/pycodex --workspace /path/to/project "inspect the tests and fix the failing one"
```

Each run prints a session ID and writes its history to `~/.pycodex/sessions/<id>.jsonl`. Continue it interactively or after a restart:

```bash
.venv/bin/pycodex --interactive --workspace /path/to/project
.venv/bin/pycodex --interactive --resume <session-id>
.venv/bin/pycodex --resume <session-id> "continue and run the tests"
```

Manage saved sessions without calling a model:

```bash
.venv/bin/pycodex --list-sessions
.venv/bin/pycodex --show-session <session-id>
.venv/bin/pycodex --fork <session-id>
```

## Isolated and parallel agents

Run one task in an isolated Git worktree. The worktree is created beside the repository under `.<repo>-pycodex-worktrees/` on a `pycodex/<name>` branch.

```bash
.venv/bin/pycodex --worktree investigate-login --workspace /path/to/project "investigate the login failure"
```

Run independent tasks concurrently with a task file. Each task gets its own worktree; use `--approval ask` for read-only research or explicitly choose a less restrictive profile for autonomous edits.

```json
{"tasks": [
  {"name": "research", "task": "inspect the failing tests and report likely causes"},
  {"name": "implementation", "task": "implement a focused fix and run relevant tests"}
]}
```

```bash
.venv/bin/pycodex --parallel /path/to/tasks.json --workspace /path/to/project --approval ask
```

Permission profiles:

```bash
.venv/bin/pycodex --approval ask --workspace /path/to/project "fix the tests"        # default: confirm all writes and commands
.venv/bin/pycodex --approval workspace --workspace /path/to/project "fix the tests" # auto-approve writes and patches; ask for commands
.venv/bin/pycodex --approval full-auto --workspace /path/to/project "fix the tests" # auto-approve built-in tools
```

`--full-auto` remains as a legacy alias for `--approval full-auto`.

It reads `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and, by default, `ANTHROPIC_SMALL_FAST_MODEL` from the local Claude settings file. Set `OPENAI_MODEL` there to override that choice. The key is never copied into this repository.

Reads are always allowed. The workspace check prevents the built-in file tools from accessing paths outside `--workspace`; it is not a replacement for a container sandbox when running untrusted commands.

Built-in coding tools include `search_text` (ripgrep matches with line context), `git_status`, `git_diff`, and `apply_patch` (unified diff only; paths are confined to the workspace and `git apply --check --no-index` must succeed before it writes).

## MCP tools

Attach stdio MCP servers with a local JSON config. Every MCP tool is treated as a mutating tool, so it follows the active approval profile.

```json
{
  "mcpServers": {
    "github": {
      "command": "your-github-mcp-server",
      "args": [],
      "env": {"GITHUB_TOKEN": "${env:GITHUB_TOKEN}"}
    },
    "database": {"command": "your-database-mcp-server", "args": []}
  }
}
```

MCP servers receive only `PATH` plus variables explicitly listed in `env`; `${env:NAME}` forwards one local environment variable. Keep the config file out of Git. Run with:

```bash
.venv/bin/pycodex --mcp-config /path/to/mcp.json --interactive --workspace /path/to/project
```

While a turn is running, the terminal prints status lines for model requests and tool calls. These report agent activity, not hidden model reasoning.

Long sessions automatically compact older history at an estimated 80,000 characters while preserving a structured summary and recent messages. The complete event log remains in the session JSONL. Use `--compact-after-chars 0` to disable it or set a lower threshold for testing.

## Trace dashboard

Install the optional web dependencies, then start the read-only local dashboard:

```bash
.venv/bin/pip install -e '.[web]'
.venv/bin/pycodex-web
```

Open `http://127.0.0.1:8765`. It lists saved sessions and renders their messages, tool calls, command results, status events, and compaction events. Pass `--session-dir /path/to/sessions` to inspect another session directory.

## Verify

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```
