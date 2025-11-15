#!/usr/bin/env node

import process from "node:process";
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { createRenderer } from "../src/renderer.js";

const LOG_DIR = path.resolve("logs");

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function openLogStream({ subcommand, prompt, threadId }) {
  ensureLogDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fallbackName = `${stamp}-${subcommand || "exec"}.jsonl`;
  const initialName = threadId ? `${threadId}.jsonl` : fallbackName;
  let filePath = path.join(LOG_DIR, initialName);
  const appendExisting = !!threadId && fs.existsSync(filePath);
  const stream = fs.createWriteStream(filePath, {
    encoding: "utf8",
    flags: appendExisting ? "a" : "w"
  });
  let recordedThreadId = threadId || null;
  let closed = false;

  if (appendExisting) {
    stream.write("\n");
  }

  stream.write(`# Prompt: ${prompt ?? ""}\n`);
  if (recordedThreadId) {
    stream.write(`# Thread: ${recordedThreadId}\n`);
  }
  stream.write(`# Timestamp: ${new Date().toISOString()}\n`);
  stream.write(`# --- JSON Output ---\n`);

  stream.on("close", () => {
    if (!recordedThreadId) {
      return;
    }
    const desiredName = `${recordedThreadId}.jsonl`;
    const desiredPath = path.join(LOG_DIR, desiredName);
    if (desiredPath === filePath) {
      return;
    }
    try {
      fs.renameSync(filePath, desiredPath);
      filePath = desiredPath;
    } catch {
      // Ignore rename failures; log content still exists under the temporary name.
    }
  });

  function recordThread(id) {
    if (!id || recordedThreadId) return;
    recordedThreadId = id;
    stream.write(`# Thread: ${id}\n`);
  }

  function writeLine(line) {
    stream.write(line + "\n");
  }

  function finalize(finalThreadId) {
    if (closed) return;
    closed = true;
    if (finalThreadId) {
      recordThread(finalThreadId);
    }
    stream.end();
  }

  return {
    writeLine,
    recordThread,
    finalize
  };
}

function reportThreadId(threadId) {
  if (threadId) {
    console.error(`当前 thread id: ${threadId}`);
    return;
  }
  console.error("当前 thread id: (无)");
}

function printUsage() {
  // Basic usage help; keep minimal for CLI.
  console.error(
    [
      "Usage:",
      "  codex-wrap exec <prompt>",
      "  codex-wrap exec    # no prompt -> interactive chat",
      "  codex-wrap resume <thread_id> <prompt>",
      "  codex-wrap resume <thread_id>   # no prompt -> interactive chat on existing thread"
    ].join("\n")
  );
}

function parseCliArgs(argv) {
  const args = [...argv];

  const subcommand = args.shift();
  if (subcommand !== "exec" && subcommand !== "resume") {
    printUsage();
    process.exit(1);
  }

  if (subcommand === "exec") {
    const prompt = args.join(" ").trim();
    if (!prompt) {
      // No prompt: enter interactive chat mode starting a new thread.
      return {
        subcommand,
        prompt: null,
        threadId: null,
        interactive: true
      };
    }
    return {
      subcommand,
      prompt,
      threadId: null,
      interactive: false
    };
  }

  // resume
  const threadId = args.shift();
  const prompt = (args || []).join(" ").trim();

  if (!threadId) {
    console.error("Error: thread_id is required for `resume`.");
    printUsage();
    process.exit(1);
  }

  if (!prompt) {
    // No prompt: interactive chat on an existing thread.
    return {
      subcommand,
      prompt: null,
      threadId,
      interactive: true
    };
  }

  return { subcommand, prompt, threadId, interactive: false };
}

function setupEscapeTermination(child) {
  const { stdin } = process;
  if (!stdin || !stdin.isTTY) {
    return { dispose() {}, aborted: () => false };
  }

  const removeListener =
    typeof stdin.off === "function"
      ? (event, fn) => stdin.off(event, fn)
      : (event, fn) => stdin.removeListener(event, fn);

  const hadRaw = !!stdin.isRaw;
  const wasPaused = typeof stdin.isPaused === "function" ? stdin.isPaused() : false;

  try {
    if (!hadRaw) {
      stdin.setRawMode(true);
    }
  } catch {
    return { dispose() {}, aborted: () => false };
  }

  if (wasPaused && typeof stdin.resume === "function") {
    stdin.resume();
  }

  let cleanedUp = false;
  let aborted = false;

  const handleData = (chunk) => {
    if (chunk == null || aborted) return;
    const text =
      typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (!text) return;
    if (!text.includes("\u001b")) return;

    aborted = true;
    console.error("\nEscape pressed. Terminating codex run...");
    if (!child.killed) {
      try {
        child.kill("SIGINT");
      } catch {
        // Ignore kill errors; process may have already exited.
      }
    }
    cleanup();
  };

  stdin.on("data", handleData);

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    removeListener("data", handleData);
    if (!hadRaw) {
      try {
        stdin.setRawMode(false);
      } catch {
        // Ignore inability to restore raw mode; best effort only.
      }
    }
    if (wasPaused && typeof stdin.pause === "function") {
      stdin.pause();
    }
  }

  return {
    dispose: cleanup,
    aborted: () => aborted
  };
}

function spawnCodexOnce(renderer, { subcommand, prompt, threadId }) {
  return new Promise((resolve) => {
    const logHandle = openLogStream({ subcommand, prompt, threadId });
    const codexArgs = [
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
      prompt
    ];

    if (subcommand === "resume" && threadId) {
      codexArgs.push("resume", threadId);
    }

    const child = spawn("codex", codexArgs, {
      cwd: process.cwd(),
      stdio: ["inherit", "pipe", "inherit"]
    });

    const escapeHandler = setupEscapeTermination(child);

    let buffer = "";
    let observedThreadId = null;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);

        const line = rawLine.trim();
        if (!line) continue;

        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          logHandle.writeLine(line);
          renderer.onNonJsonLine?.(line, err);
          continue;
        }

        if (
          !observedThreadId &&
          parsed &&
          parsed.type === "thread.started" &&
          typeof parsed.thread_id === "string"
        ) {
          observedThreadId = parsed.thread_id;
          logHandle.recordThread(parsed.thread_id);
        }

        logHandle.writeLine(line);
        renderer.onEvent(parsed);
      }
    });

    child.on("error", (err) => {
      escapeHandler.dispose();
      renderer.onProcessError?.(err);
      logHandle.finalize(observedThreadId || threadId);
      process.exitCode = 1;
      resolve({ code: 1, threadId: observedThreadId, aborted: false });
    });

    child.on("close", (code, signal) => {
      escapeHandler.dispose();
      const aborted = escapeHandler.aborted();
      renderer.onProcessExit?.(code, signal, aborted);
      if (!aborted && code !== 0) {
        process.exitCode = code ?? 1;
      }
      logHandle.finalize(observedThreadId || threadId);
      resolve({ code, signal, threadId: observedThreadId, aborted });
    });
  });
}

async function runInteractive(options) {
  const { subcommand } = options;
  const renderer = createRenderer();

  let currentThreadId = options.threadId || null;

  renderer.onStart?.({
    subcommand,
    prompt: null,
    threadId: currentThreadId,
    interactive: true
  });

  console.error(
    [
      "Interactive mode.",
      "Type a message and press Enter.",
      "Commands:",
      "  /exit, /quit   exit chat",
      "  /thread        print current thread id"
    ].join("\n")
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let closed = false;

  rl.on("close", () => {
    closed = true;
    reportThreadId(currentThreadId);
    console.error("Bye.");
  });

  const ask = () => {
    if (closed) return;
    rl.question("> ", async (input) => {
      const text = input.trim();
      if (!text) {
        ask();
        return;
      }

      if (text === "/exit" || text === "/quit") {
        closed = true;
        rl.close();
        return;
      }

      if (text === "/thread") {
        if (currentThreadId) {
          console.error(`Current thread: ${currentThreadId}`);
        } else {
          console.error("No thread yet. Send a message first.");
        }
        ask();
        return;
      }

      const effectiveSubcommand = currentThreadId ? "resume" : subcommand;

      const { threadId } = await spawnCodexOnce(renderer, {
        subcommand: effectiveSubcommand,
        prompt: text,
        threadId: currentThreadId
      });

      if (!currentThreadId && threadId) {
        currentThreadId = threadId;
      }

      ask();
    });
  };

  ask();
}

async function run() {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.interactive) {
    await runInteractive(options);
    return;
  }

  const { subcommand, prompt, threadId } = options;
  const renderer = createRenderer();
  renderer.onStart?.({
    subcommand,
    prompt,
    threadId,
    interactive: false
  });

  const result = await spawnCodexOnce(renderer, { subcommand, prompt, threadId });
  const finalThreadId = result.threadId || threadId || null;
  reportThreadId(finalThreadId);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
