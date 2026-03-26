import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANDIDATE_LIST_URLS = [
  "https://www.assembly.go.kr/portal/member/memberList.do",
  "https://www.assembly.go.kr/members/22ndassem/memList.do"
];
const CURRENT_MEMBER_API = "https://open.assembly.go.kr/portal/openapi/nwvrqwxyaytdsfvhu";

function getFetch() {
  if (typeof fetch === "function") return fetch;
  return (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

function normalizeName(name) {
  return String(name || "").replace(/\s+/g, "").trim();
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x3A;/gi, ":");
}

function absolutizeUrl(src, baseUrl) {
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return "";
  }
}

function isLikelyImage(url) {
  return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url) || /openassm/i.test(url);
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function extractFromJsonPairs(html, pageUrl) {
  const map = new Map();

  const pairRegexA = /"NAAS_NM"\s*:\s*"([^"]+)"[\s\S]{0,700}?"NAAS_PIC"\s*:\s*"([^"]+)"/g;
  const pairRegexB = /"NAAS_PIC"\s*:\s*"([^"]+)"[\s\S]{0,700}?"NAAS_NM"\s*:\s*"([^"]+)"/g;

  let match;
  while ((match = pairRegexA.exec(html)) !== null) {
    const name = decodeHtml(match[1]).trim();
    const photo = absolutizeUrl(decodeHtml(match[2]).trim(), pageUrl);
    if (name && photo) map.set(normalizeName(name), photo);
  }

  while ((match = pairRegexB.exec(html)) !== null) {
    const photo = absolutizeUrl(decodeHtml(match[1]).trim(), pageUrl);
    const name = decodeHtml(match[2]).trim();
    if (name && photo) map.set(normalizeName(name), photo);
  }

  return map;
}

function parseAttrs(tag) {
  const attrs = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(["'])(.*?)\2/g;
  let m;
  while ((m = attrRegex.exec(tag)) !== null) {
    attrs[m[1].toLowerCase()] = decodeHtml(m[3]);
  }
  return attrs;
}

function extractFromImgAlt(html, pageUrl) {
  const map = new Map();
  const imgTagRegex = /<img\b[^>]*>/gi;
  let m;

  while ((m = imgTagRegex.exec(html)) !== null) {
    const attrs = parseAttrs(m[0]);
    const alt = String(attrs.alt || "").trim();
    const src = String(attrs.src || "").trim();
    if (!alt || !src) continue;
    if (!/[가-힣]/.test(alt)) continue;

    const photo = absolutizeUrl(src, pageUrl);
    if (!photo || !isLikelyImage(photo)) continue;

    map.set(normalizeName(alt), photo);
  }

  return map;
}

async function fetchListHtml(fetchFn, url) {
  const res = await fetchFn(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    throw new Error(`Failed ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function parseApiRows(payload) {
  const direct = payload?.nwvrqwxyaytdsfvhu?.[1]?.row;
  if (Array.isArray(direct)) return direct;
  const root = Object.values(payload || {}).find(
    (v) => Array.isArray(v) && Array.isArray(v?.[1]?.row)
  );
  return Array.isArray(root?.[1]?.row) ? root[1].row : [];
}

async function fetchFromCurrentMemberApi(fetchFn, apiKey) {
  if (!apiKey) return new Map();

  const url = new URL(CURRENT_MEMBER_API);
  url.search = new URLSearchParams({
    KEY: apiKey,
    Type: "json",
    pIndex: "1",
    pSize: "500",
  }).toString();

  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Current member API failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const rows = parseApiRows(json);
  const map = new Map();

  for (const row of rows) {
    const name = String(row?.HG_NM || row?.NAAS_NM || "").trim();
    const pic = String(row?.NAAS_PIC || "").trim();
    if (!name || !pic) continue;
    map.set(normalizeName(name), pic);
  }

  return map;
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");

  const membersPath = path.join(projectRoot, "data", "members.json");
  const outputPath = path.join(projectRoot, "data", "member_photos.json");
  loadEnvFile(path.join(projectRoot, ".env"));

  if (!existsSync(membersPath)) {
    throw new Error("data/members.json not found. Run fetchMembers first.");
  }

  const members = JSON.parse(await readFile(membersPath, "utf8"));
  if (!Array.isArray(members)) {
    throw new Error("data/members.json must be an array.");
  }

  const fetchFn = getFetch();
  const targetNames = new Map();
  for (const member of members) {
    const name = String(member?.name || "").trim();
    if (!name) continue;
    targetNames.set(normalizeName(name), name);
  }

  const mergedCandidates = new Map();
  let usedSource = "";

  for (const pageUrl of CANDIDATE_LIST_URLS) {
    try {
      const html = await fetchListHtml(fetchFn, pageUrl);
      const fromJson = extractFromJsonPairs(html, pageUrl);
      const fromAlt = extractFromImgAlt(html, pageUrl);

      for (const [k, v] of fromJson) mergedCandidates.set(k, v);
      for (const [k, v] of fromAlt) mergedCandidates.set(k, v);

      if (mergedCandidates.size > 0) {
        usedSource = pageUrl;
        break;
      }
    } catch {
      // Try next candidate URL.
    }
  }

  if (!usedSource) {
    const apiMap = await fetchFromCurrentMemberApi(fetchFn, process.env.ASSEMBLY_API_KEY || "");
    for (const [k, v] of apiMap) mergedCandidates.set(k, v);
    if (apiMap.size > 0) {
      usedSource = "nwvrqwxyaytdsfvhu (fallback)";
    }
  }

  if (!usedSource) {
    throw new Error("Could not extract photo candidates from list pages or fallback API.");
  }

  const output = {};
  let matched = 0;

  for (const [normalized, originalName] of targetNames.entries()) {
    const photo = mergedCandidates.get(normalized) || "";
    if (photo) matched += 1;
    output[originalName] = photo;
  }

  const sortedOutput = Object.fromEntries(
    Object.entries(output).sort((a, b) => a[0].localeCompare(b[0], "ko"))
  );

  await writeFile(outputPath, `${JSON.stringify(sortedOutput, null, 2)}\n`, "utf8");

  console.log(`Photo source: ${usedSource}`);
  console.log(`Target members: ${members.length}`);
  console.log(`Photo candidates extracted: ${mergedCandidates.size}`);
  console.log(`Matched photos: ${matched}`);
  console.log(`Wrote file: ${outputPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
