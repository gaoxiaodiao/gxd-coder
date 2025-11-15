# gxd-coder

## Usage

- `npm start -- "your prompt"` – run a one-off `codex exec` call. Omit the prompt to enter interactive mode for a new thread.
- `npm run resume -- <thread_id> "your prompt"` – send a message on an existing thread. Omit the prompt to enter interactive mode for that thread.

Logs for each run are written under `logs/<thread_id>.jsonl`.
