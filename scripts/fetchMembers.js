import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALL_ENDPOINT = "https://open.assembly.go.kr/portal/openapi/ALLNAMEMBER";
const CURRENT_ENDPOINT = "https://open.assembly.go.kr/portal/openapi/nwvrqwxyaytdsfvhu";

const CHOSEONG = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"
];

const JUNGSEONG = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"
];

const JONGSEONG = [
  "", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "h"
];

function getFetch() {
  if (typeof fetch === "function") return fetch;
  return (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

function isHangulSyllable(char) {
  const code = char.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3;
}

function romanizeHangul(text) {
  let out = "";

  for (const ch of text) {
    if (!isHangulSyllable(ch)) {
      out += ch;
      continue;
    }

    const code = ch.charCodeAt(0) - 0xac00;
    const cho = Math.floor(code / 588);
    const jung = Math.floor((code % 588) / 28);
    const jong = code % 28;

    out += `${CHOSEONG[cho]}${JUNGSEONG[jung]}${JONGSEONG[jong]}`;
  }

  return out;
}

function slugifyLatin(text) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function pickCurrentSegment(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.split("/").map((v) => v.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

function pickCurrentUnit(value) {
  const latest = pickCurrentSegment(value);
  const parts = latest.split(",").map((v) => v.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : latest;
}

function makeMemberId(name, index) {
  const clean = String(name || "").trim();
  if (!clean) return `member_${index + 1}`;

  if (/^[\uac00-\ud7a3]+$/.test(clean) && clean.length >= 3) {
    const surname = romanizeHangul(clean[0]);
    const given = romanizeHangul(clean.slice(1));
    const id = slugifyLatin(`${surname}_${given}`);
    return id || `member_${index + 1}`;
  }

  const id = slugifyLatin(romanizeHangul(clean));
  return id || `member_${index + 1}`;
}

function parseRows(payload, datasetName) {
  const primaryRows = payload?.[datasetName]?.[1]?.row;
  if (Array.isArray(primaryRows)) return primaryRows;

  const root = Object.values(payload || {}).find(
    (v) => Array.isArray(v) && Array.isArray(v?.[1]?.row)
  );
  return Array.isArray(root?.[1]?.row) ? root[1].row : [];
}

async function fetchPagedRows(fetchFn, endpoint, datasetName, apiKey) {
  const pageSize = 1000;
  const maxPages = 30;
  const rows = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      KEY: apiKey,
      Type: "json",
      pIndex: String(page),
      pSize: String(pageSize),
    }).toString();

    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`Assembly API request failed: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    const pageRows = parseRows(json, datasetName);
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }

  return rows;
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
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");
  loadEnvFile(path.join(projectRoot, ".env"));

  const key = process.env.ASSEMBLY_API_KEY;
  if (!key) {
    throw new Error("ASSEMBLY_API_KEY is required.");
  }

  const fetchFn = getFetch();
  const allRows = await fetchPagedRows(fetchFn, ALL_ENDPOINT, "ALLNAMEMBER", key);
  const currentRosterRows = await fetchPagedRows(fetchFn, CURRENT_ENDPOINT, "nwvrqwxyaytdsfvhu", key);

  const currentCodes = new Set(
    currentRosterRows
      .map((r) => String(r?.MONA_CD || "").trim())
      .filter(Boolean)
  );
  const currentByCode = new Map(
    currentRosterRows
      .map((r) => [String(r?.MONA_CD || "").trim(), r])
      .filter(([code]) => Boolean(code))
  );

  const currentRows = allRows.filter((row) => {
    const monaCode = String(row?.NAAS_CD || "").trim();
    const unit = String(row?.GTELT_ERACO || "").trim();
    return unit.includes("제22대") && currentCodes.has(monaCode);
  });

  console.log(`Total rows from API: ${allRows.length}`);
  console.log(`Filtered rows (current assembly): ${currentRows.length}`);

  const members = currentRows.map((row, idx) => {
    const monaCode = String(row?.NAAS_CD || "").trim();
    const current = currentByCode.get(monaCode) || {};

    // Prefer current roster API values to avoid historical party/district leakage.
    const name = String(current?.HG_NM || row?.NAAS_NM || "").trim();
    const party = pickCurrentSegment(current?.POLY_NM || row?.PLPT_NM);
    const district = pickCurrentSegment(current?.ORIG_NM || row?.ELECD_NM);
    const committee = pickCurrentSegment(current?.CMIT_NM || row?.CMIT_NM);
    const reelection = pickCurrentSegment(current?.REELE_GBN_NM || row?.RLCT_DIV_NM);
    const unit = pickCurrentUnit(current?.UNITS || row?.GTELT_ERACO);
    const homepage = String(current?.HOMEPAGE || row?.NAAS_HP_URL || "").trim();
    const photo = String(row?.NAAS_PIC || "").trim();

    return {
      monaCode,
      id: makeMemberId(name, idx),
      name,
      party,
      district,
      committee,
      reelection,
      unit,
      homepage,
      photo,
    };
  });

  const uniqueMembers = [];
  const seenCodes = new Set();
  for (const m of members) {
    const keyCode = m.monaCode || m.id;
    if (seenCodes.has(keyCode)) continue;
    seenCodes.add(keyCode);
    uniqueMembers.push(m);
  }

  const dataDir = path.resolve(projectRoot, "data");
  const outputFile = path.join(dataDir, "members.json");

  await mkdir(dataDir, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(uniqueMembers, null, 2)}\n`, "utf8");

  console.log(`Fetched ${uniqueMembers.length} members`);
  console.log(`Wrote file: ${outputFile}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
