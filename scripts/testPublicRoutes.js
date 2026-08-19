import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_ROUTE_GROUPS } from "./syncPublicRoutes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let targetCount = 0;

for (const group of PUBLIC_ROUTE_GROUPS) {
  const source = await readFile(path.join(root, group.source), "utf8");
  for (const target of group.targets) {
    const publicPage = await readFile(path.join(root, target), "utf8");
    assert.equal(publicPage, source, `${target} is out of sync with ${group.source}`);
    assert.doesNotMatch(publicPage, /location\.replace\s*\(/, `${target} still performs a client redirect`);
    targetCount += 1;
  }
}

console.log(`Public route audit passed: ${targetCount} pages.`);
