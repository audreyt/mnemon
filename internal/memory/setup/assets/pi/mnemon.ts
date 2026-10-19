import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function promptDir(): string {
  return path.join(process.env.MNEMON_DATA_DIR || path.join(homedir(), ".mnemon"), "prompt", "pi");
}

function agentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (!configured) return path.join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || (process.platform === "win32" && configured.startsWith("~\\"))) {
    return path.join(homedir(), configured.slice(2));
  }
  return configured;
}

function readGuide(): string {
  try {
    // The shared guide contains Claude-only delegation instructions. Never
    // fall back to it, including when an older installation needs setup again.
    return readFileSync(path.join(promptDir(), "guide.md"), "utf8");
  } catch {
    return "";
  }
}

function npmBinary(entry: string): string {
  // Resolve the installed target registry, as the OpenCode integration does.
  // Bypass npm's launcher so the timeout kills the native process itself.
  const root = path.dirname(path.dirname(entry));
  const targets = JSON.parse(readFileSync(path.join(root, "targets.json"), "utf8"));
  const target = targets.find((item: { platform: string; arch: string }) =>
    item.platform === process.platform && item.arch === process.arch);
  if (!target) throw new Error("Unsupported Mnemon platform");
  const require = createRequire(entry);
  const native = path.dirname(require.resolve(`${target.alias}/package.json`));
  return path.join(native, target.binary);
}

function isNpmLauncher(entry: string): boolean {
  if (!entry.endsWith(`${path.sep}bin${path.sep}mnemon.js`)) return false;
  try {
    const root = path.dirname(path.dirname(entry));
    return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name === "@mnemon-dev/mnemon";
  } catch {
    return false;
  }
}

function mnemonCommand(): string {
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    const binary = path.join(directory, process.platform === "win32" ? "mnemon.exe" : "mnemon");
    if (existsSync(binary)) {
      // Match PATH lookup: a directory or non-executable file must not shadow
      // a working executable later in PATH on Unix.
      try {
        if (!statSync(binary).isFile()) continue;
        accessSync(binary, constants.X_OK);
      } catch {
        continue;
      }
      const resolved = realpathSync(binary);
      return isNpmLauncher(resolved) ? npmBinary(resolved) : binary;
    }
    if (process.platform === "win32") {
      // Node cannot execute npm's .cmd shim without a shell. Locate the
      // corresponding global or project-local package instead.
      for (const modules of [path.join(directory, "node_modules"), path.dirname(directory)]) {
        const entry = path.join(modules, "@mnemon-dev", "mnemon", "bin", "mnemon.js");
        if (existsSync(entry)) return npmBinary(entry);
      }
    }
  }
  return "mnemon";
}

function memoryStatus(): string {
  try {
    const result = spawnSync(mnemonCommand(), ["status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      killSignal: "SIGKILL",
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return "[mnemon] Memory active.";
    const stats = JSON.parse(result.stdout);
    return `[mnemon] Memory active (${stats.total_insights ?? 0} insights, ${stats.edge_count ?? 0} edges).`;
  } catch {
    return "[mnemon] Memory active.";
  }
}

function visibleMessage(content: string) {
  return {
    customType: "mnemon",
    content,
    display: true,
  };
}

export default function (pi: ExtensionAPI) {
  pi.on("resources_discover", async () => {
    const skill = path.join(agentDir(), "skills", "mnemon", "SKILL.md");
    return {
      skillPaths: existsSync(skill) ? [skill] : [],
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("mnemon", "mnemon");
  });

  pi.on("before_agent_start", async () => {
    const guide = readGuide();
    const content = [memoryStatus(), guide, "[mnemon] Evaluate: recall needed? After responding, evaluate: remember needed?"]
      .filter(Boolean)
      .join("\n\n");

    return { message: visibleMessage(content) };
  });

  pi.on("agent_end", async (_event, ctx) => {
    ctx.ui.notify("[mnemon] Consider whether this exchange warrants durable memory.", "info");
  });

  pi.on("session_before_compact", async () => {
    return {
      customInstructions: "[mnemon] Before compacting, preserve only critical continuity with mnemon remember when justified. Do not store the full transcript.",
    };
  });
}
