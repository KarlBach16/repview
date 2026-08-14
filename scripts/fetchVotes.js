import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const ENDPOINT = "https://open.assembly.go.kr/portal/openapi/nojepdqqaweusdfbi";
const DATASET_NAME = "nojepdqqaweusdfbi";
const VOTE_SUMMARY_ENDPOINT = "https://open.assembly.go.kr/portal/openapi/ncocpgfiaoituanbr";
const VOTE_SUMMARY_DATASET_NAME = "ncocpgfiaoituanbr";
const AGE = "22";
const PAGE_SIZE = 300;
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

function compactBodySnippet(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

async function readJsonResponse(res, label) {
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${label} HTTP ${res.status} ${res.statusText}: ${compactBodySnippet(body)}`);
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`${label} invalid JSON: ${error.message || error}. Body: ${compactBodySnippet(body)}`);
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

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchWithRetry(fetchFn, url, label) {
  const maxAttempts = 4;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "RepView data updater (https://repview.app)",
        },
      });

      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
        continue;
      }

      return res;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function fetchVoteSummaries(fetchFn, apiKey) {
  const pageSize = 1000;
  let page = 1;
  const summaries = new Map();

  while (true) {
    const url = new URL(VOTE_SUMMARY_ENDPOINT);
    url.search = new URLSearchParams({
      KEY: apiKey,
      Type: "json",
      pIndex: String(page),
      pSize: String(pageSize),
      AGE,
    }).toString();

    const res = await fetchWithRetry(fetchFn, url, `vote summaries page ${page}`);
    const json = await readJsonResponse(res, `vote summaries page ${page}`);
    if (json?.RESULT?.CODE?.startsWith("ERROR")) {
      throw new Error(`Vote summaries API ${json.RESULT.CODE}: ${json.RESULT.MESSAGE}`);
    }

    const pageRows = parseRows(json, VOTE_SUMMARY_DATASET_NAME);
    for (const row of pageRows) {
      const billId = String(row?.BILL_ID || "").trim();
      if (!billId) continue;
      summaries.set(billId, {
        billId,
        billNo: pickFirst(row, ["BILL_NO"]),
        title: pickFirst(row, ["BILL_NAME"]),
        processedDate: pickFirst(row, ["PROC_DT"]),
        result: pickFirst(row, ["PROC_RESULT_CD"]),
        memberCount: toNumber(row?.MEMBER_TCNT),
        voteCount: toNumber(row?.VOTE_TCNT),
        yesCount: toNumber(row?.YES_TCNT),
        noCount: toNumber(row?.NO_TCNT),
        abstainCount: toNumber(row?.BLANK_TCNT),
        linkUrl: pickFirst(row, ["LINK_URL"]),
      });
    }

    if (pageRows.length < pageSize) break;
    page += 1;
  }

  return [...summaries.values()];
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

    const res = await fetchWithRetry(fetchFn, url, `votes BILL_ID=${billId} page ${page}`);
    const json = await readJsonResponse(res, `votes BILL_ID=${billId} page ${page}`);
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
    party: pickFirst(row, ["POLY_NM"]),
    billId: pickFirst(row, ["BILL_ID"]),
    billNo: pickFirst(row, ["BILL_NO"]),
    title: pickFirst(row, ["BILL_NAME"]),
    voteDate: pickFirst(row, ["VOTE_DATE"]),
    choice: pickFirst(row, ["RESULT_VOTE_MOD"]),
  }));
}

async function writeGzipJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, gzipSync(`${JSON.stringify(value)}\n`, { level: 9 }));
  await rename(tempPath, filePath);
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");

  loadEnvFile(path.join(projectRoot, ".env"));
  const apiKey = process.env.ASSEMBLY_API_KEY;
  if (!apiKey) throw new Error("ASSEMBLY_API_KEY is required.");

  const outDir = path.join(projectRoot, "data", "raw");
  const outPath = path.join(outDir, "votes_raw.json.gz");
  const summariesPath = path.join(outDir, "vote_summaries.json.gz");
  const legacyOutPath = path.join(outDir, "votes_raw.json");
  const fetchFn = getFetch();
  const summaries = await fetchVoteSummaries(fetchFn, apiKey);
  const billIds = summaries.map((summary) => summary.billId);
  if (billIds.length === 0) throw new Error("No bill IDs found for vote collection.");

  const previousSummaries = existsSync(summariesPath)
    ? JSON.parse(gunzipSync(readFileSync(summariesPath)).toString("utf8"))
    : [];
  if (previousSummaries.length > 0 && summaries.length < previousSummaries.length) {
    throw new Error(
      `Vote summary count regressed from ${previousSummaries.length} to ${summaries.length}; refusing to replace data.`
    );
  }

  const existingVotes = existsSync(outPath)
    ? JSON.parse(gunzipSync(readFileSync(outPath)).toString("utf8"))
    : existsSync(legacyOutPath)
      ? JSON.parse(readFileSync(legacyOutPath, "utf8"))
      : [];
  const officialBillIds = new Set(billIds);
  const existingBillIds = new Set(
    existingVotes.map((vote) => String(vote?.billId || "").trim()).filter(Boolean)
  );
  const billsMissingParty = new Set(
    existingVotes
      .filter((vote) => !String(vote?.party || "").trim())
      .map((vote) => String(vote?.billId || "").trim())
      .filter(Boolean)
  );
  const pendingBillIds = billIds.filter(
    (billId) => !existingBillIds.has(billId) || billsMissingParty.has(billId)
  );
  const pendingBillIdSet = new Set(pendingBillIds);
  const newRows = [];
  const failedBillIds = [];

  await mapWithConcurrency(
    pendingBillIds,
    async (billId, idx) => {
      try {
        const rows = await fetchRowsByBill(fetchFn, apiKey, billId);
        if (rows.length === 0) {
          throw new Error("official vote summary exists but member vote rows are empty");
        }
        newRows.push(...rows);
      } catch (err) {
        failedBillIds.push(billId);
        if (failedBillIds.length <= 10) {
          console.warn(`[warn] skipped BILL_ID=${billId}: ${err.message || err}`);
        }
      }

      if ((idx + 1) % 200 === 0 || idx + 1 === pendingBillIds.length) {
        console.log(`Processed new BILL_IDs: ${idx + 1}/${pendingBillIds.length}`);
      }
    },
    CONCURRENCY
  );

  const finalFailedBillIds = [];
  if (failedBillIds.length > 0) {
    console.warn(`Retrying ${failedBillIds.length} failed bill request(s) with lower concurrency.`);
    await mapWithConcurrency(
      failedBillIds,
      async (billId) => {
        try {
          const rows = await fetchRowsByBill(fetchFn, apiKey, billId);
          if (rows.length === 0) {
            throw new Error("official vote summary exists but member vote rows are empty");
          }
          newRows.push(...rows);
        } catch (error) {
          finalFailedBillIds.push(billId);
          console.warn(`[warn] final retry failed BILL_ID=${billId}: ${error.message || error}`);
        }
      },
      2
    );
  }

  if (finalFailedBillIds.length > 0) {
    throw new Error(
      `Vote collection incomplete after final retry: ${finalFailedBillIds.length} bill request(s) failed.`
    );
  }

  const normalized = [
    ...existingVotes
      .filter((vote) => {
        const billId = String(vote?.billId || "").trim();
        return officialBillIds.has(billId) && !pendingBillIdSet.has(billId);
      })
      .map(({ name: _unusedName, ...vote }) => vote),
    ...normalizeVotes(newRows),
  ];
  const uniqueMembers = new Set(normalized.map((v) => v.monaCode).filter(Boolean));

  if (normalized.length === 0 && (existsSync(outPath) || existsSync(legacyOutPath))) {
    console.warn("Votes API fetch returned no rows; keeping existing raw vote data.");
    return;
  }

  await mkdir(outDir, { recursive: true });
  await writeGzipJsonAtomic(outPath, normalized);
  await writeGzipJsonAtomic(summariesPath, summaries);

  console.log(`Total rows fetched: ${normalized.length}`);
  console.log(`Official voted bills: ${summaries.length}`);
  console.log(`Unique members found: ${uniqueMembers.size}`);
  console.log(`Wrote file: ${outPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
