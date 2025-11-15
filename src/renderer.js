import chalk from "chalk";

const SHOW_REASONING =
  process.env.CODEX_WRAP_SHOW_REASONING === "1" ||
  process.env.CODEX_WRAP_SHOW_THINKING === "1";

function makeRenderer(palette, name) {
  const { bold, dim, gray, green, yellow, cyan, red, blue, magenta } = palette;

  let turnCounter = 0;
  let haveShownThread = false;

  function headerPrefix() {
    return dim(bold(`[codex-wrap:${name}]`));
  }

  function onStart(meta) {
    const parts = [];
    parts.push(headerPrefix());
    parts.push(dim(`renderer=${name}`));
    parts.push(dim(`mode=${meta.subcommand}`));
    if (meta.threadId) {
      parts.push(dim(`thread=${meta.threadId}`));
    }
    console.error(parts.join("  "));
    console.error("");
  }

  function onEvent(ev) {
    switch (ev.type) {
      case "thread.started":
        renderThreadStarted(ev.thread_id);
        break;
      case "turn.started":
        renderTurnStarted();
        break;
      case "turn.completed":
        renderTurnCompleted(ev.usage);
        break;
      case "item.completed":
        renderItemCompleted(ev.item);
        break;
      case "item.started":
        // For now we ignore item.started events in output;
        // completed events contain the final state we care about.
        break;
      default:
        renderUnknownEvent(ev);
    }
  }

  function renderThreadStarted(threadId) {
    if (haveShownThread) return;
    haveShownThread = true;
    console.log(gray(bold(`Thread: ${threadId}`)));
  }

  function renderTurnStarted() {
    turnCounter += 1;
    console.log("");
    console.log(gray(`--- Turn #${turnCounter} ---`));
  }

  function renderTurnCompleted(usage = {}) {
    // Token summaries are intentionally hidden to reduce noise.
    void usage;
  }

  function renderItemCompleted(item) {
    if (!item || typeof item !== "object") return;
    switch (item.type) {
      case "agent_message":
        renderAgentMessage(item);
        break;
      case "reasoning":
        renderReasoning(item);
        break;
      case "file_change":
        renderFileChange(item);
        break;
      case "command_execution":
        renderCommandExecution(item);
        break;
      case "todo_list":
        renderTodoList(item);
        break;
      default:
        renderUnknownItem(item);
    }
  }

  function renderAgentMessage(item) {
    console.log("");
    console.log(
      bold(cyan("[Agent]")),
      // keep original markdown / formatting
      item.text ?? ""
    );
  }

  function renderReasoning(item) {
    if (!SHOW_REASONING) return;
    console.log("");
    console.log(bold(magenta("[Thinking]")));
    console.log(dim(item.text ?? ""));
  }

  function renderFileChange(item) {
    const changes = [];
    if (Array.isArray(item.changes)) {
      changes.push(...item.changes);
    } else if (item.file_change && typeof item.file_change === "object") {
      changes.push(item.file_change);
    }
    if (changes.length === 0) return;

    for (const change of changes) {
      const kind = change.kind || "change";
      const path = change.path || "";
      let label = "Changed";
      let colorFn = blue;
      if (kind === "add") {
        label = "Added";
        colorFn = green;
      } else if (kind === "update") {
        label = "Edited";
        colorFn = yellow;
      } else if (kind === "delete") {
        label = "Deleted";
        colorFn = red;
      }
      console.log("");
      console.log(bold(colorFn(`[${label}]`)), path);
    }
  }

  function renderCommandExecution(item) {
    const cmd = item.command || "";
    const exit = item.exit_code;
    const ok = exit === 0 || typeof exit !== "number";
    const tagColor = ok ? green : red;

    console.log("");
    const exitInfo =
      typeof exit === "number" ? gray(`(exit=${exit})`) : gray("(exit=?)");
    console.log(bold(tagColor("[Ran]")), cmd, exitInfo);

    const output = item.aggregated_output;
    if (output && typeof output === "string") {
      const maxLines = 8;
      const normalized = output.replace(/\n$/, "");
      const lines = normalized ? normalized.split("\n") : [];
      const limited = lines.slice(0, maxLines);
      for (const line of limited) {
        console.log(gray("  > " + line));
      }
      if (lines.length > maxLines) {
        console.log(gray(`  > ... (${lines.length - maxLines} lines omitted)`));
      }
    }
  }

  function renderTodoList(item) {
    const items = item.items;
    if (!Array.isArray(items)) return;
    console.log("");
    console.log(bold(blue("[Plan]")));
    for (const step of items) {
      const text = step.text || "";
      const done = !!step.completed;
      const mark = done ? green("✓") : yellow("•");
      console.log(`  ${mark} ${text}`);
    }
  }

  function renderUnknownItem(item) {
    console.log("");
    console.log(dim(`[item:${item.type ?? "unknown"}]`));
  }

  function renderUnknownEvent(ev) {
    console.log("");
    console.log(dim(`[event:${ev.type ?? "unknown"}]`));
  }

  function onNonJsonLine(line) {
    console.error(dim(`[non-json] ${line}`));
  }

  function onProcessExit(code, signal, aborted) {
    if (aborted) {
      console.error(dim("codex run cancelled (Escape)."));
      return;
    }
    if (code === 0) return;
    if (signal) {
      console.error(red(`codex terminated by signal ${signal}`));
      return;
    }
    console.error(red(`codex exited with code ${code ?? "?"}`));
  }

  function onProcessError(err) {
    console.error(red("Error spawning codex:"), err?.message || err);
  }

  return {
    onStart,
    onEvent,
    onNonJsonLine,
    onProcessExit,
    onProcessError
  };
}

export function createRenderer() {
  const palette = {
    bold: chalk.bold,
    dim: chalk.dim,
    gray: chalk.gray,
    green: chalk.green,
    yellow: chalk.yellow,
    cyan: chalk.cyan,
    red: chalk.red,
    blue: chalk.blue,
    magenta: chalk.magenta
  };
  return makeRenderer(palette, "chalk");
}
