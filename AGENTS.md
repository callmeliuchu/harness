# PyCodex Core Instructions

## Scope

- This repository is a small, headless Python coding-agent core. Do not add a TUI.
- Keep the core dependency-light. The web dashboard remains optional under the `web` extra.
- Use the OpenAI-compatible DeepSeek configuration from `~/.claude/settings.json`; never copy API keys or settings into the repository.

## Development

- Target Python 3.12 or newer and preserve the existing async style.
- Make focused changes only. Do not refactor unrelated code or reformat unrelated files.
- Put package code in `src/pycodex/` and tests in `tests/`.
- Add or update focused tests for behavior changes.

## Verification

- Run `.venv/bin/python -m unittest discover -s tests -v` after code changes.
- For dashboard changes, also check that `python -m compileall -q src` succeeds.
- Do not make real model API calls merely to test a change.

## Safety

- Preserve workspace confinement for file operations and commands.
- Keep `apply_patch` validation before applying any patch.
- Do not weaken approval profiles or make `full-auto` the default.
- Do not read, print, persist, or commit secrets from local configuration files.

## Local artifacts

- Session traces live outside the repository in `~/.pycodex/sessions/`.
- Do not commit `.venv/`, generated caches, session logs, or unrelated untracked files.
