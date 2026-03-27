import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_PAGE = "https://clerk.house.gov/Members/ViewMemberProfiles";
const SOURCE_BASE = "https://clerk.house.gov";

function getFetch() {
  if (typeof fetch === "function") return fetch;
  return (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

function normalizeDistrict(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return "";
  if (text.includes("at large") || text === "0th") return "AL";
  const digits = text.match(/\d+/);
  return digits ? String(Number(digits[0])) : "";
}

function normalizeDistrictCode(state, district) {
  const s = String(state || "").trim().toUpperCase();
  const d = normalizeDistrict(district);
  if (!s || !d) return "";
  return `${s}-${d}`;
}

function normalizeName(raw) {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toAbsoluteImageUrl(rawPath) {
  const v = String(rawPath || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `${SOURCE_BASE}${v.startsWith("/") ? "" : "/"}${v}`;
}

function parseCardsFromHtml(html) {
  const cards = [];
  const liRegex = /<li class="col-xs-6[\s\S]*?<\/li>/g;
  const liMatches = html.match(liRegex) || [];

  for (const li of liMatches) {
    const bioguideMatch = li.match(/href="\/members\/([A-Z0-9]+)"/i);
    const imageMatch = li.match(/data-src="([^"]+)"/i);
    const ariaMatch = li.match(/aria-label="([^"]+)"/i);
    const nameTextMatch = li.match(/<h2 class="member-name">[\s\S]*?<text>([^<]+)<\/text>/i);

    const bioguideId = (bioguideMatch?.[1] || "").trim().toUpperCase();
    const photo = toAbsoluteImageUrl(imageMatch?.[1] || "");

    let state = "";
    let district = "";
    let parsedName = "";

    const aria = ariaMatch?.[1] || "";
    if (aria) {
      const stateMatch = aria.match(/\(([A-Z]{2})\)/);
      state = (stateMatch?.[1] || "").toUpperCase();

      const districtMatch = aria.match(/district:\s*([^,]+)/i);
      district = (districtMatch?.[1] || "").trim();

      const head = aria.split(/,\s*state:/i)[0] || "";
      parsedName = head.replace(/\s+/g, " ").trim();
    }

    const nameText = (nameTextMatch?.[1] || "").replace(/\s+/g, " ").trim();
    const displayName = nameText || parsedName;

    if (!bioguideId || !photo) continue;

    cards.push({
      bioguideId,
      photo,
      name: displayName,
      state,
      district,
      districtCode: normalizeDistrictCode(state, district),
    });
  }

  return cards;
}

async function maybeDownloadPhotos(fetchFn, rows, projectRoot) {
  const shouldDownloadLocal = process.argv.includes("--download-local");
  if (!shouldDownloadLocal) return { downloaded: 0, mode: "remote" };

  const outDir = path.join(projectRoot, "img", "us", "members");
  await mkdir(outDir, { recursive: true });

  let downloaded = 0;
  for (const row of rows) {
    const id = String(row.bioguideId || "").trim().toUpperCase();
    const photoUrl = String(row.photo || "").trim();
    if (!id || !photoUrl) continue;

    try {
      const res = await fetchFn(photoUrl);
      if (!res.ok) continue;
      const arrayBuffer = await res.arrayBuffer();
      const fileName = `${id}.jpg`;
      const filePath = path.join(outDir, fileName);
      await writeFile(filePath, Buffer.from(arrayBuffer));
      row.photo = `/img/us/members/${fileName}`;
      downloaded += 1;
    } catch {
      // keep remote URL if local download fails
    }
  }

  return { downloaded, mode: "local" };
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");

  const membersPath = path.join(projectRoot, "data", "us", "house_members.json");
  const members = JSON.parse(await readFile(membersPath, "utf8"));

  if (!Array.isArray(members) || members.length === 0) {
    throw new Error("house_members.json is empty. Run fetchUSHouseMembers.js first.");
  }

  const fetchFn = getFetch();
  const res = await fetchFn(SOURCE_PAGE, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch House Clerk member profiles: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const cards = parseCardsFromHtml(html);

  const byBioguide = new Map(cards.map((c) => [c.bioguideId, c]));
  const byNameDistrict = new Map();
  for (const c of cards) {
    const key = `${normalizeName(c.name)}|${String(c.districtCode || "").toUpperCase()}`;
    if (normalizeName(c.name) && c.districtCode && !byNameDistrict.has(key)) {
      byNameDistrict.set(key, c);
    }
  }

  let matched = 0;
  let unmatched = 0;
  let matchedByBioguide = 0;
  let matchedByFallback = 0;

  for (const m of members) {
    const id = String(m.bioguideId || "").trim().toUpperCase();
    const direct = id ? byBioguide.get(id) : null;

    if (direct?.photo) {
      m.photo = direct.photo;
      matched += 1;
      matchedByBioguide += 1;
      continue;
    }

    const fallbackKey = `${normalizeName(m.name)}|${String(m.districtCode || "").toUpperCase()}`;
    const fallback = byNameDistrict.get(fallbackKey);

    if (fallback?.photo) {
      m.photo = fallback.photo;
      matched += 1;
      matchedByFallback += 1;
    } else {
      m.photo = "";
      unmatched += 1;
    }
  }

  const { downloaded, mode } = await maybeDownloadPhotos(fetchFn, members, projectRoot);

  await writeFile(membersPath, `${JSON.stringify(members, null, 2)}\n`, "utf8");

  console.log(`Photo source used: House Clerk (${SOURCE_PAGE})`);
  console.log(`Profiles parsed from source: ${cards.length}`);
  console.log(`Matched photos: ${matched}`);
  console.log(`  - via bioguideId: ${matchedByBioguide}`);
  console.log(`  - via fallback (name + district): ${matchedByFallback}`);
  console.log(`Unmatched photos: ${unmatched}`);
  if (mode === "local") {
    console.log(`Local download mode: enabled`);
    console.log(`Downloaded local photos: ${downloaded}`);
  } else {
    console.log(`Local download mode: disabled (using remote Clerk image URLs)`);
  }
  console.log(`Wrote file: ${membersPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
