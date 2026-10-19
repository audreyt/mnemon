import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extension, isolatedEnv, legacy, npmLayout, probe } from "./fixtures.mjs";

for (const npm of [false, true]) {
  for (const overflow of [false, true]) {
    test(`${npm ? "npm" : "native"} status ${overflow ? "output bound" : "timeout"} kills and reaps the child`, { skip: process.platform === "win32" }, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "mnemon-pi-process-"));
      const pidFile = path.join(root, "pid");
      try {
        const bin = path.join(root, "bin");
        await mkdir(bin);
        const fake = path.join(bin, "mnemon");
        await writeFile(fake, `#!/usr/bin/env node
process.on("SIGTERM", () => {});
require("node:fs").writeFileSync(process.env.MNEMON_TEST_PID, String(process.pid));
${overflow ? 'process.stdout.write("x".repeat(512 * 1024));' : ''}
setInterval(() => {}, 1000);
`, { mode: 0o755 });
        const selected = npm ? (await npmLayout(path.join(root, "npm"), fake)).bin : bin;
        const env = { ...isolatedEnv(root, selected + path.delimiter + path.dirname(process.execPath)), MNEMON_TEST_PID: pidFile };
        const result = spawnSync(process.execPath, ["--no-warnings", probe, extension], {
          cwd: root, env, encoding: "utf8", timeout: 9000, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
        });
        assert.equal(result.status, 0, `extension exceeded its deadline: ${result.error}\n${result.stderr}`);
        assert.ok(JSON.parse(result.stdout).start.message.content.startsWith("[mnemon] Memory active.\n"));
        const pid = Number(await readFile(pidFile, "utf8"));
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "native child must be reaped");
      } finally {
        try { process.kill(Number(await readFile(pidFile, "utf8")), "SIGKILL"); } catch {}
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}

for (const wrapper of [false, true]) {
  test(`preserve PATH behavior for ${wrapper ? "unrelated mnemon.js wrapper" : "non-executable shadow"}`, { skip: process.platform === "win32" }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mnemon-pi-path-"));
    try {
      const bin = path.join(root, "bin");
      const shadow = path.join(root, "shadow");
      await mkdir(bin); await mkdir(shadow);
      const fake = path.join(bin, wrapper ? "mnemon.js" : "mnemon");
      await writeFile(fake, '#!/usr/bin/env node\nconsole.log(JSON.stringify({total_insights:7,edge_count:9}));\n', { mode: 0o755 });
      if (wrapper) await symlink(fake, path.join(bin, "mnemon"));
      else await writeFile(path.join(shadow, "mnemon"), "not executable", { mode: 0o644 });
      const env = isolatedEnv(root, [shadow, bin, path.dirname(process.execPath)].join(path.delimiter));
      for (const source of [legacy, extension]) {
        const result = spawnSync(process.execPath, ["--no-warnings", probe, source], {
          cwd: root, env, encoding: "utf8", timeout: 9000, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(JSON.parse(result.stdout).start.message.content, /7 insights, 9 edges/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
