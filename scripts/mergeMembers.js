import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dataDir = path.resolve(__dirname, "..", "data");

  const membersPath = path.join(dataDir, "members.json");
  const photosPath = path.join(dataDir, "member_photos.json");

  const members = await readJson(membersPath, []);
  const photoMap = await readJson(photosPath, {});

  if (!Array.isArray(members)) {
    throw new Error("data/members.json must be an array.");
  }

  const normalizedMap = (photoMap && typeof photoMap === "object") ? photoMap : {};

  let matched = 0;
  const merged = members.map((m) => {
    const name = String(m?.name || "").trim();
    const mappedPhoto = String(normalizedMap[name] || "").trim();
    if (mappedPhoto) matched += 1;

    return {
      ...m,
      photo: mappedPhoto || "",
    };
  });

  await writeFile(membersPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  console.log(`Members loaded: ${members.length}`);
  console.log(`Matched photos: ${matched}`);
  console.log(`Wrote file: ${membersPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
