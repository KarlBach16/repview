import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_ROUTE_GROUPS = [
  { source: "pages/kr/index.html", targets: ["index.html", "kr/index.html"] },
  { source: "pages/kr/member.html", targets: ["member.html", "kr/member.html"] },
  { source: "pages/kr/bill.html", targets: ["bill.html", "kr/bill.html"] },
  { source: "pages/kr/ranking.html", targets: ["ranking.html", "kr/ranking.html"] },
  { source: "pages/kr/compare.html", targets: ["compare.html", "kr/compare.html"] },
  { source: "pages/us/index.html", targets: ["us/index.html"] },
  { source: "pages/us/member.html", targets: ["us/member.html"] },
];

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let targetCount = 0;
  for (const group of PUBLIC_ROUTE_GROUPS) {
    const content = await readFile(path.join(root, group.source), "utf8");
    for (const target of group.targets) {
      await writeAtomic(path.join(root, target), content);
      targetCount += 1;
    }
  }
  console.log(`Synced ${targetCount} public route pages.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
