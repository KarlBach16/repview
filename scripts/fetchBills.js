import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://open.assembly.go.kr/portal/openapi/nzmimeepazxkubdpn";

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

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
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

async function fetchWithRetry(fetchFn, url, label) {
  const maxAttempts = 5;
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
        console.warn(`Fetch returned ${res.status} (${label}, attempt ${attempt}/${maxAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
        continue;
      }

      return res;
    } catch (error) {
      lastError = error;
      console.warn(`Fetch failed (${label}, attempt ${attempt}/${maxAttempts}): ${error.message || error}`);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function fetchPagedRows(fetchFn, key) {
  const pageSize = 1000;
  const maxPages = 30;
  const rows = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({
      KEY: key,
      Type: "json",
      pIndex: String(page),
      pSize: String(pageSize),
      AGE: "22",
    }).toString();

    const res = await fetchWithRetry(fetchFn, url, `bills page ${page}`);
    const json = await readJsonResponse(res, `bills page ${page}`);
    if (json?.RESULT?.CODE?.startsWith("ERROR")) {
      throw new Error(`Bills API error ${json.RESULT.CODE}: ${json.RESULT.MESSAGE}`);
    }

    const pageRows = parseRows(json, "nzmimeepazxkubdpn");
    rows.push(...pageRows);

    if (pageRows.length < pageSize) break;
  }

  return rows;
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");

  loadEnvFile(path.join(projectRoot, ".env"));
  const key = process.env.ASSEMBLY_API_KEY;
  if (!key) throw new Error("ASSEMBLY_API_KEY is required.");

  const outDir = path.join(projectRoot, "data", "raw");
  const outPath = path.join(outDir, "bills_raw.json");

  const fetchFn = getFetch();
  let rows = [];
  try {
    rows = await fetchPagedRows(fetchFn, key);
  } catch (error) {
    if (!existsSync(outPath)) throw error;
    console.warn("Bills API fetch failed; keeping existing data/raw/bills_raw.json.");
    console.warn(error instanceof Error ? error.message : String(error));
    return;
  }

  console.log("Raw row sample (bills):", rows[0] || null);

  const normalized = rows.map((row) => {
    const proposerCodes = pickFirst(row, ["RST_MONA_CD", "MONA_CD", "PUBL_MONA_CD"]);
    const monaCode = proposerCodes.split(",")[0]?.trim() || "";

    return {
      monaCode,
      memberName: pickFirst(row, ["RST_PROPOSER", "PROPOSER", "NAAS_NM", "HG_NM"]),
      billTitle: pickFirst(row, ["BILL_NAME", "BILL_NM"]),
      proposalDate: pickFirst(row, ["PROPOSE_DT", "PROPOSAL_DT"]),
      billStatus: pickFirst(row, ["PROC_RESULT", "LAW_PROC_RESULT_CD", "CMT_PROC_RESULT_CD"]),
      billId: pickFirst(row, ["BILL_ID", "BILL_NO"]),
      detailLink: pickFirst(row, ["DETAIL_LINK"]),
      source: row,
    };
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  console.log(`Total rows fetched: ${normalized.length}`);
  console.log(`Wrote file: ${outPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
