import { chmod, copyFile, cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repository = fileURLToPath(new URL("../../..", import.meta.url));
export const probe = fileURLToPath(new URL("probe.mjs", import.meta.url));
export const extension = path.join(repository, "internal/memory/setup/assets/pi/mnemon.ts");
export const legacy = path.join(repository, "testdata/memory/pi/mnemon-before-164.ts");
export const executable = process.platform === "win32" ? "mnemon.exe" : "mnemon";

export function isolatedEnv(home, binDir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(MNEMON_|PI_|HOME$|USERPROFILE$|PATH$|XDG_CONFIG_HOME$)/i.test(key)));
  Object.assign(env, {
    USERPROFILE: home,
    PATH: binDir,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    MNEMON_EMBED_ENDPOINT: "http://127.0.0.1:1",
    MNEMON_EMBED_PROTOCOL: "ollama",
  });
  if (process.platform !== "win32") env.HOME = home;
  return env;
}

// Standard global/local npm layouts, using this checkout's launcher, target
// registry, and real built product. No registry or provider request is needed.
export async function npmLayout(root, product, local = false) {
  const modules = path.join(root, "node_modules");
  const pkg = path.join(modules, "@mnemon-dev", "mnemon");
  await cp(path.join(repository, "npm/cli"), pkg, { recursive: true });
  const targets = JSON.parse(await readFile(path.join(pkg, "targets.json"), "utf8"));
  const target = targets.find((item) => item.platform === process.platform && item.arch === process.arch);
  if (!target) throw new Error("unsupported fixture platform");
  const native = path.join(modules, target.alias, target.binary);
  await mkdir(path.dirname(native), { recursive: true });
  await writeFile(path.join(modules, target.alias, "package.json"), JSON.stringify({ name: target.alias }));
  await copyFile(product, native);
  await chmod(native, 0o755);
  const bin = local ? path.join(modules, ".bin") : root;
  await mkdir(bin, { recursive: true });
  const entry = path.join(pkg, "bin", "mnemon.js");
  await chmod(entry, 0o755);
  if (process.platform === "win32") {
    // A real .cmd entry exists on PATH, but raw Node cannot execute it.
    await writeFile(path.join(bin, "mnemon.cmd"), `@ECHO OFF\r\n"${process.execPath}" "${entry}" %*\r\n`);
  } else {
    await symlink(entry, path.join(bin, "mnemon"));
  }
  return { bin, native, entry };
}
