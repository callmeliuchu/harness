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

## Verify

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```
