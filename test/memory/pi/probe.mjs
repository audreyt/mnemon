import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

// Execute installed bytes through raw Node, without a host shim that might
// supply HOME or silently route .cmd through a shell.
const source = stripTypeScriptTypes(await readFile(process.argv[2], "utf8"));
const extension = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const hooks = new Map();
extension.default({ on(name, handler) { hooks.set(name, handler); } });
console.log(JSON.stringify({
  resources: await hooks.get("resources_discover")(),
  start: await hooks.get("before_agent_start")(),
}));
