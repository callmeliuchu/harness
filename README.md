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

For unattended operation, add `--full-auto`:

```bash
.venv/bin/pycodex --full-auto --workspace /path/to/project "run the tests and fix failures"
```

It reads `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and, by default, `ANTHROPIC_SMALL_FAST_MODEL` from the local Claude settings file. Set `OPENAI_MODEL` there to override that choice. The key is never copied into this repository.

Every write or command requires a terminal confirmation unless `--full-auto` is supplied. Reads are allowed automatically. The workspace check prevents the built-in file tools from accessing paths outside `--workspace`; it is not a replacement for a container sandbox when running untrusted commands.

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
