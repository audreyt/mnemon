import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { releaseDownloadBadge, writeReleaseDownloadBadge } from "./release-downloads.mjs";

const asset = (name, download_count) => ({ name, download_count });

test("counts published packages across versions while excluding checksums and other files", () => {
  const badge = releaseDownloadBadge([
    { assets: [
      asset("mnemon_0.1.0_linux_amd64.tar.gz", 1200),
      asset("mnemon_0.1.0_windows_amd64.zip", 34),
      asset("checksums.txt", 9000),
      asset("mnemon_0.1.0_linux_amd64.tar.gz.sha256", 500),
      asset("source.zip", 70),
    ] },
    { prerelease: true, assets: [asset("mnemon_0.2.0-rc1_darwin_arm64.tar.gz", 56)] },
    { draft: true, assets: [asset("mnemon_0.3.0_linux_arm64.tar.gz", 999)] },
  ]);
  assert.deepEqual(badge, {
    schemaVersion: 1, label: "GitHub downloads", message: "1.3k", color: "brightgreen",
  });
});

test("an empty public release set produces a valid zero badge", () => {
  assert.equal(releaseDownloadBadge([]).message, "0");
});

test("formats totals with npm badge precision, including unit rollover", () => {
  const cases = [
    [999, "999"], [1000, "1k"], [1290, "1.3k"], [9950, "9.9k"],
    [9999, "10k"], [10000, "10k"], [19633, "20k"], [123456, "123k"],
    [999499, "999k"], [999500, "1M"], [1000000, "1M"], [1250000, "1.3M"],
    [12600000, "13M"], [999500000, "1G"], [1000000000, "1G"],
    [1000000000000, "1T"], [Number.MAX_SAFE_INTEGER, "9P"],
  ];
  for (const [count, expected] of cases) {
    const badge = releaseDownloadBadge([{ assets: [asset("mnemon_1_linux_amd64.tar.gz", count)] }]);
    assert.equal(badge.message, expected, `downloads: ${count}`);
  }
});

test("invalid archive counts and incomplete responses fail instead of silently undercounting", () => {
  for (const count of [-1, 1.5, "3", undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => releaseDownloadBadge([{ assets: [asset("mnemon_1_linux_amd64.tar.gz", count)] }]), /Invalid download count/);
  }
  assert.throws(() => releaseDownloadBadge([{}]), /Missing release assets/);
});

test("combines every API page and preserves the existing badge when refresh fails", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mnemon-download-badge-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "release-downloads.json");
  const pages = [
    [{ assets: [asset("mnemon_2_linux_arm64.tar.gz", 7)] }],
    [{ assets: [asset("mnemon_1_windows_amd64.zip", 11)] }],
  ];
  await writeReleaseDownloadBadge("mnemon-dev/mnemon", output, () => JSON.stringify(pages));
  const previous = await readFile(output, "utf8");
  assert.equal(JSON.parse(previous).message, "18");
  await assert.rejects(writeReleaseDownloadBadge("mnemon-dev/mnemon", output, () => {
    throw new Error("GitHub unavailable");
  }), /GitHub unavailable/);
  await assert.rejects(writeReleaseDownloadBadge("mnemon-dev/mnemon", output, () => JSON.stringify([{ message: "rate limited" }])));
  assert.equal(await readFile(output, "utf8"), previous);
});
