import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://www.give.go.kr";
const LIST_URL = `${BASE_URL}/portal/supporter/supporterSearch/list.do`;
const CONCURRENCY = 10;

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, " ").replace(/&middot;/gi, "·")
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
}

function textContent(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalizedAssociationMemberName(value) {
  return textContent(value).replace(/^국회의원/, "").replace(/후원회$/, "").replace(/[\s·]/g, "").trim();
}

function regionTokens(value) {
  return [...String(value || "").matchAll(/([가-힣]+?(?:특별자치시|광역시|특별시|자치구|시|군|구))/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function supporterRecordForMember(member, records) {
  const memberName = String(member?.name || "").replace(/[\s·]/g, "");
  const candidates = records.filter((record) => record.memberName === memberName);
  if (candidates.length <= 1) return candidates[0] || null;

  const memberRegions = new Set(regionTokens(member?.district));
  const scored = candidates.map((record) => ({
    record,
    score: regionTokens(record.region).filter((region) => memberRegions.has(region)).length,
  })).sort((a, b) => b.score - a.score);

  const bestScore = scored[0]?.score || 0;
  const regionalMatches = scored.filter((candidate) => candidate.score === bestScore);
  if (bestScore > 0 && regionalMatches.length === 1) return regionalMatches[0].record;
  const activeMatches = regionalMatches.filter((candidate) => candidate.record.donationUrl);
  if (bestScore > 0 && activeMatches.length === 1) return activeMatches[0].record;
  console.warn(`Ambiguous supporter association: ${memberName} (${member?.district || "no district"})`);
  return null;
}

async function fetchText(url, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "RepView data updater (https://repview.app)" } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function parseList(html) {
  const body = String(html || "").match(/<tbody id\s*=\s*["']listPcbody["']>([\s\S]*?)<\/tbody>/i)?.[1] || "";
  const records = [];
  for (const row of body.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 4) continue;
    const intro = row[1].match(/pop_intro\(['"](\d+)['"]\)/i);
    const associationAnchor = cells[2].match(/<a[^>]*pop_intro[^>]*>([\s\S]*?)<\/a>/i);
    if (!intro || !associationAnchor) continue;
    const associationName = textContent(associationAnchor[1]);
    const donationPath = row[1].match(/href=["']([^"']*\/portal\/give\.do\?supportNo=\d+)["']/i)?.[1] || "";
    records.push({
      congressNo: intro[1], associationName,
      memberName: normalizedAssociationMemberName(associationName),
      party: textContent(cells[1]), region: textContent(cells[3]),
      donationUrl: donationPath ? new URL(donationPath, BASE_URL).href : "",
    });
  }
  return records;
}

function tableValue(html, label) {
  const expression = new RegExp(`<th[^>]*>\\s*${label}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i");
  return textContent(String(html || "").match(expression)?.[1] || "");
}

function tableLink(html, label) {
  const expression = new RegExp(`<th[^>]*>\\s*${label}\\s*<\\/th>\\s*<td[^>]*>[\\s\\S]*?<a[^>]*href=["']([^"']+)["']`, "i");
  const raw = decodeHtml(String(html || "").match(expression)?.[1] || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, BASE_URL);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function kstDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(__filename), "..");
  const members = JSON.parse(await readFile(path.join(projectRoot, "data", "members.json"), "utf8"));
  const url = new URL(LIST_URL);
  url.search = new URLSearchParams({ menuNo: "200025", search: "Y", gubCd: "GUB101", pageIndex: "1", pageSize: "500", pageUnit: "500" }).toString();
  const listRecords = parseList(await fetchText(url));
  const matched = members
    .map((member) => ({ member, record: supporterRecordForMember(member, listRecords) }))
    .filter(({ record }) => Boolean(record));
  const output = {};

  for (let index = 0; index < matched.length; index += CONCURRENCY) {
    const batch = matched.slice(index, index + CONCURRENCY);
    const details = await Promise.all(batch.map(async ({ record }) => {
      const sourceUrl = `${BASE_URL}/portal/supporter/supporterSearch/congressView.do?viewType=BODY&congressNo=${record.congressNo}`;
      return { sourceUrl, html: await fetchText(sourceUrl) };
    }));
    for (let offset = 0; offset < batch.length; offset += 1) {
      const { member, record } = batch[offset];
      const { sourceUrl, html } = details[offset];
      output[member.monaCode] = {
        associationName: record.associationName, party: record.party, region: record.region,
        phone: tableValue(html, "후원회 전화") || tableValue(html, "사무실 전화"),
        address: tableValue(html, "주소"), homepage: tableLink(html, "홈페이지"),
        donationUrl: record.donationUrl, sourceUrl,
      };
    }
    console.log(`Fetched supporter associations: ${Math.min(index + CONCURRENCY, matched.length)}/${matched.length}`);
  }

  const outputPath = path.join(projectRoot, "data", "kr", "supporter_associations.json");
  await writeFile(outputPath, `${JSON.stringify({ dataAsOf: kstDate(), source: "National Election Commission Political Fund Center", members: output }, null, 2)}\n`, "utf8");
  console.log(`Matched current members: ${matched.length}/${members.length}`);
  console.log(`Wrote file: ${outputPath}`);
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
