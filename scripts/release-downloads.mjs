#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function releaseDownloadBadge(releases) {
  if (!Array.isArray(releases)) throw new Error("Expected a release array");
  let downloads = 0;
  for (const release of releases) {
    if (release.draft) continue;
    if (!Array.isArray(release.assets)) throw new Error("Missing release assets");
    for (const asset of release.assets) {
      if (typeof asset.name !== "string") throw new Error("Missing asset name");
      if (!/^mnemon_.+\.(?:tar\.gz|zip)$/.test(asset.name)) continue;
      if (!Number.isSafeInteger(asset.download_count) || asset.download_count < 0) {
        throw new Error(`Invalid download count for ${asset.name}`);
      }
      downloads += asset.download_count;
      if (!Number.isSafeInteger(downloads)) throw new Error("Download count overflow");
    }
  }
  return {
    schemaVersion: 1,
    label: "GitHub downloads",
    message: downloads.toLocaleString("en-US"),
    color: "brightgreen",
  };
}

export async function writeReleaseDownloadBadge(repository, output, run = execFileSync) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Expected owner/repository");
  const pages = JSON.parse(run("gh", [
    "api", "--paginate", "--slurp", `repos/${repository}/releases?per_page=100`,
  ], { encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }));
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(Array.isArray)) {
    throw new Error("Expected paginated release arrays");
  }
  const badge = releaseDownloadBadge(pages.flat());
  await writeFile(output, JSON.stringify(badge, null, 2) + "\n");
  return badge;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [, , repository, output] = process.argv;
    if (!repository || !output) throw new Error("Usage: release-downloads.mjs owner/repo output.json");
    const badge = await writeReleaseDownloadBadge(repository, output);
    process.stdout.write(`${badge.message} release package downloads\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
