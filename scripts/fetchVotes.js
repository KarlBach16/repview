import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://open.assembly.go.kr/portal/openapi/nojepdqqaweusdfbi";
const DATASET_NAME = "nojepdqqaweusdfbi";
const AGE = "22";
const PAGE_SIZE = 500;
const CONCURRENCY = 8;

function getFetch() {
  if (typeof fetch === "function") return fetch;
  return (...args) => import("node-fetch").then(({ default: f }) => f(...args));
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

    const envKey = trimmed.slice(0, idx).trim();
    const envValue = trimmed.slice(idx + 1).trim();
    if (!process.env[envKey]) process.env[envKey] = envValue;
  }
}

function parseRows(payload, datasetName) {
  const rows = payload?.[datasetName]?.[1]?.row;
  if (Array.isArray(rows)) return rows;

  const root = Object.values(payload || {}).find(
    (v) => Array.isArray(v) && Array.isArray(v?.[1]?.row)
  );
  return Array.isArray(root?.[1]?.row) ? root[1].row : [];
}

function pickFirst(row, keys) {
  for (const key of keys) {
    const v = row?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

function getBillIds(billsRawPath) {
  if (!existsSync(billsRawPath)) {
    throw new Error(
      `Missing ${billsRawPath}. Run node scripts/fetchBills.js first to prepare bill IDs.`
    );
  }

  const rows = JSON.parse(readFileSync(billsRawPath, "utf8"));
  const ids = new Set();

  for (const row of rows) {
    const billId = row?.billId || row?.BILL_ID || row?.source?.BILL_ID || "";
    const procDt = row?.source?.PROC_DT || row?.source?.RGS_PROC_DT || row?.source?.LAW_PROC_DT || "";
    if (billId && procDt) ids.add(billId);
  }

  return [...ids];
}

async function fetchRowsByBill(fetchFn, apiKey, billId) {
  let page = 1;
  const rows = [];

  while (true) {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({
      KEY: apiKey,
      Type: "json",
      pIndex: String(page),
      pSize: String(PAGE_SIZE),
      AGE,
      BILL_ID: billId,
    }).toString();

    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`request failed for BILL_ID=${billId}: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    if (json?.RESULT?.CODE?.startsWith("ERROR")) {
      throw new Error(`API ${json.RESULT.CODE} for BILL_ID=${billId}: ${json.RESULT.MESSAGE}`);
    }

    const pageRows = parseRows(json, DATASET_NAME);
    rows.push(...pageRows);

    if (pageRows.length < PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

async function mapWithConcurrency(items, worker, limit = 8) {
  const results = [];
  let cursor = 0;

  async function runOne() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runOne());
  await Promise.all(runners);
  return results;
}

function normalizeVotes(rows) {
  return rows.map((row) => ({
    monaCode: pickFirst(row, ["MONA_CD"]),
    name: pickFirst(row, ["HG_NM"]),
    billId: pickFirst(row, ["BILL_ID"]),
    billNo: pickFirst(row, ["BILL_NO"]),
    title: pickFirst(row, ["BILL_NAME"]),
    voteDate: pickFirst(row, ["VOTE_DATE"]),
    choice: pickFirst(row, ["RESULT_VOTE_MOD"]),
  }));
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");

  loadEnvFile(path.join(projectRoot, ".env"));
  const apiKey = process.env.ASSEMBLY_API_KEY;
  if (!apiKey) throw new Error("ASSEMBLY_API_KEY is required.");

  const billsRawPath = path.join(projectRoot, "data", "raw", "bills_raw.json");
  const billIds = getBillIds(billsRawPath);
  if (billIds.length === 0) throw new Error("No bill IDs found for vote collection.");

  const fetchFn = getFetch();
  const allRows = [];
  let failedCount = 0;

  await mapWithConcurrency(
    billIds,
    async (billId, idx) => {
      try {
        const rows = await fetchRowsByBill(fetchFn, apiKey, billId);
        allRows.push(...rows);
      } catch (err) {
        failedCount += 1;
        if (failedCount <= 10) {
          console.warn(`[warn] skipped BILL_ID=${billId}: ${err.message || err}`);
        }
      }

      if ((idx + 1) % 200 === 0 || idx + 1 === billIds.length) {
        console.log(`Processed BILL_IDs: ${idx + 1}/${billIds.length}`);
      }
    },
    CONCURRENCY
  );

  const normalized = normalizeVotes(allRows);
  const uniqueMembers = new Set(normalized.map((v) => v.monaCode).filter(Boolean));

  const outDir = path.join(projectRoot, "data", "raw");
  const outPath = path.join(outDir, "votes_raw.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  console.log(`Total rows fetched: ${normalized.length}`);
  console.log(`Unique members found: ${uniqueMembers.size}`);
  console.log(`Wrote file: ${outPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
