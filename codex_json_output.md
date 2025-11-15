# Codex CLI `--json` Output Reference

This document is based on the real commands:

- `codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json '<prompt>'`
- `codex exec ... --json '<prompt>' resume <thread_id>`

The sample files `codex_wrapper_thread1.json` and `codex_wrapper_thread2.json` capture the output and let us summarize the common event types and payload structures produced by `codex --json`. The goal is to make it easy to build wrappers that parse and map the events.

## Top-Level Event Types

Each line of output is an individual JSON object. Important fields include:

- `type`: the top-level event name (string)
- other fields: depend on `type`, e.g., `thread_id`, `item`, `usage`

The samples include the following `type` values:

- `thread.started`
- `turn.started`
- `item.started`
- `item.completed`
- `turn.completed`

### `thread.started`

Indicates that a Codex thread has been created (or marked again when `resume` is used):

```json
{"type":"thread.started","thread_id":"019a851a-0ee8-7920-829f-9359904b16ac"}
```

Field:

- `thread_id`: unique ID for this conversation. Later you can send `resume <thread_id>` to continue the same thread.

### `turn.started`

Marks the beginning of a "turn" (one `codex exec` invocation):

```json
{"type":"turn.started"}
```

The current samples do not contain extra fields.

### `turn.completed`

Marks the end of a turn and provides token statistics:

```json
{
  "type":"turn.completed",
  "usage":{
    "input_tokens":55304,
    "cached_input_tokens":43264,
    "output_tokens":751
  }
}
```

Fields:

- `usage.input_tokens`: number of input tokens for the turn
- `usage.cached_input_tokens`: number of cached input tokens
- `usage.output_tokens`: number of output tokens

## `item.started` / `item.completed`

Most "visual" messages (Added / Edited / Ran / Updated Plan / reasoning / replies) are wrapped inside `item.*` events:

- `{"type":"item.started", ...}`
- `{"type":"item.completed", ...}`

Shared fields:

- `item`: the object describing the specific entry
  - `id`: item identifier (e.g., `"item_3"`)
  - `type`: item type (see below)
  - other fields: depend on the item type, such as `text`, `changes`, `command`, `items`, etc.

### Overview of Item Types

The samples contain the following `item.type` values:

- `reasoning`: internal thoughts (not shown to end users; explain agent decisions)
- `agent_message`: natural-language response shown to the user
- `file_change`: file additions/modifications (maps to "Added" / "Edited")
- `command_execution`: shell commands (maps to "Ran")
- `todo_list`: internal plan/todo list (maps to "Updated Plan" in the UI)

Each type is described below.

### `item.type = "reasoning"` (internal thinking)

Example:

```json
{
  "type":"item.completed",
  "item":{
    "id":"item_0",
    "type":"reasoning",
    "text":"**Setting up and executing commands**\n\nI need to set the work directory ..."
  }
}
```

Fields:

- `item.text`: the model's internal reasoning text (usually English with Markdown formatting)

Usage:

- Useful for debugging or building a "thinking" view, but normally not surfaced directly to users.

### `item.type = "agent_message"` (reply to the user)

Example:

```json
{
  "type":"item.completed",
  "item":{
    "id":"item_1",
    "type":"agent_message",
    "text":"I'll create `wrapper_test.txt` first and then run `echo wrapper-run` ..."
  }
}
```

Field:

- `item.text`: user-facing natural-language content (often Markdown)

Usage:

- These entries form the main body of the final response. You can render them in the wrapper in chronological order.

### `item.type = "file_change"` (Added / Edited)

Initial file creation:

```json
{
  "type":"item.completed",
  "item":{
    "id":"item_2",
    "type":"file_change",
    "changes":[
      {
        "path":"/Users/.../wrapper_test.txt",
        "kind":"add"
      }
    ],
    "status":"completed"
  }
}
```

Subsequent edits to the same file:

```json
{
  "type":"item.completed",
  "item":{
    "id":"item_3",
    "type":"file_change",
    "changes":[
      {
        "path":"/Users/.../wrapper_test.txt",
        "kind":"update"
      }
    ],
    "status":"completed"
  }
}
```

Key fields:

- `item.changes`: array of file-change objects
  - `path`: absolute file path
  - `kind`: `"add"` / `"update"` (and potentially `"delete"`, etc.)
- `item.status`: `"completed"` (and other states if errors occur)

In the CLI UI this normally maps to:

- `kind = "add"` → “Added”
- `kind = "update"` → “Edited”

In the wrapper you can:

- Use `kind` to decide whether the change is an addition, edit, or deletion
- Use `path` to show which files changed

### `item.type = "command_execution"` (Ran)

Example (running `echo wrapper-run`):

```json
{
  "type":"item.started",
  "item":{
    "id":"item_3",
    "type":"command_execution",
    "command":"zsh -lc 'echo wrapper-run'",
    "aggregated_output":"",
    "exit_code":null,
    "status":"in_progress"
  }
}
{
  "type":"item.completed",
  "item":{
    "id":"item_3",
    "type":"command_execution",
    "command":"zsh -lc 'echo wrapper-run'",
    "aggregated_output":"wrapper-run\n",
    "exit_code":0,
    "status":"completed"
  }
}
```

Fields:

- `item.command`: the shell command executed
- `item.aggregated_output`: combined stdout (may contain newlines)
- `item.exit_code`: process exit code (`0` on success)
- `item.status`: `"in_progress"`, `"completed"`, etc.

In the CLI UI this becomes:

- “Ran `<command>`” together with a collapsible block containing the command output

In the wrapper you can:

- Use `command` as the heading (“Ran: zsh -lc '...'”)
- Display `aggregated_output` as the body
- Decide success/failure based on `exit_code`

### `item.type = "todo_list"` (Updated Plan / plan view)

Initial plan:

```json
{
  "type":"item.started",
  "item":{
    "id":"item_5",
    "type":"todo_list",
    "items":[
      {"text":"Create wrapper_test.txt","completed":true},
      {"text":"Run the command and list directory files","completed":true}
    ]
  }
}
{
  "type":"item.completed",
  "item":{
    "id":"item_5",
    "type":"todo_list",
    "items":[
      {"text":"Create wrapper_test.txt","completed":true},
      {"text":"Run the command and list directory files","completed":true}
    ]
  }
}
```

Updated plan (adds a third step):

```json
{
  "type":"item.started",
  "item":{
    "id":"item_5",
    "type":"todo_list",
    "items":[
      {"text":"Create wrapper_test.txt","completed":true},
      {"text":"Run the command and list directory files","completed":true},
      {"text":"Append a second line and show the file content","completed":true}
    ]
  }
}
```

Fields:

- `item.items`: array describing the plan steps
  - `text`: description of the step
  - `completed`: boolean indicating if it is done

In the CLI UI these appear as “Plan / Updated Plan” cards.

In the wrapper you can:

- Parse `todo_list` into a structured task list
- Compare multiple `todo_list` entries to see how the plan evolves

## Mapping to CLI Labels (From / To)

Based on the samples we can map wrapper UI blocks as follows:

- “Added” → `item.type = "file_change"` and `changes[*].kind = "add"`
- “Edited” → `item.type = "file_change"` and `changes[*].kind = "update"`
- “Ran” → `item.type = "command_execution"`
- “Updated Plan” (plan view) → `item.type = "todo_list"`
- Internal reasoning (usually hidden from users) → `item.type = "reasoning"`
- Regular reply content → `item.type = "agent_message"`

The CLI sometimes labels read-only operations as “Explored”; in JSON they still appear as `command_execution` or other tool-specific types, so the wrapper can treat them like any other command entry.

## Parsing Recommendations for Wrappers

1. **Parse line by line**: each line is an independent JSON object, so you can stream and parse incrementally.
2. **Dispatch on `type`, then inspect `item.type`**:
   - `type === "thread.started"`: record `thread_id` for later `resume` calls.
   - `type === "turn.completed"`: capture token statistics or log them.
   - `type === "item.*"`: map to UI components based on `item.type`.
3. **Maintain a message list for the UI**:
   - `agent_message` → text blocks
   - `file_change` → file-change blocks (Added/Edited/Deleted)
   - `command_execution` → command blocks (Ran/Explored)
   - `todo_list` → plan blocks
   - `reasoning` → optional “thinking” tab for debugging

To cover more scenarios, gather additional `--json` outputs that include errors, deletions, and other actions, and extend these notes accordingly. Even with just the two samples (`codex_wrapper_thread1.json` / `codex_wrapper_thread2.json`), you can already build a useful parsing layer for the Codex CLI wrapper.
