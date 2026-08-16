import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveVoteSimilarities } from "../lib/deriveRepresentativeMetrics.js";

const CONGRESS = 119;
const BASE_URL = "https://voteview.com/static/data/out";
const URLS = {
  members: `${BASE_URL}/members/H${CONGRESS}_members.csv`,
  votes: `${BASE_URL}/votes/H${CONGRESS}_votes.csv`,
  rollcalls: `${BASE_URL}/rollcalls/H${CONGRESS}_rollcalls.csv`,
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value); value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = []; value = "";
    } else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])));
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "RepView data updater (https://repview.app)" } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}

function choiceFromCastCode(value) {
  const code = Number(value);
  if ([1, 2, 3].includes(code)) return "yes";
  if ([4, 5, 6].includes(code)) return "no";
  return "";
}

function displayBillNumber(value) {
  const match = String(value || "").trim().match(/^([A-Z]+)(\d+)$/);
  if (!match) return String(value || "").trim();
  const type = { HR: "H.R.", HRES: "H.Res.", HJRES: "H.J.Res.", HCONRES: "H.Con.Res.", S: "S.", SRES: "S.Res.", SJRES: "S.J.Res.", SCONRES: "S.Con.Res." }[match[1]] || match[1];
  return `${type} ${match[2]}`;
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(__filename), "..", "..");
  const houseMembers = JSON.parse(await readFile(path.join(projectRoot, "data", "us", "house_members.json"), "utf8"));
  const [memberRows, voteRows, rollcallRows] = (await Promise.all(Object.values(URLS).map(fetchText))).map(parseCsv);
  const bioguideByIcpsr = new Map(memberRows.filter((row) => row.chamber === "House" && row.bioguide_id).map((row) => [String(row.icpsr), String(row.bioguide_id).trim().toUpperCase()]));
  const rollcallByNumber = new Map(rollcallRows.filter((row) => row.chamber === "House").map((row) => [String(row.rollnumber), row]));

  const similarityRows = voteRows.flatMap((row) => {
    if (row.chamber !== "House") return [];
    const bioguideId = bioguideByIcpsr.get(String(row.icpsr));
    const rollcall = rollcallByNumber.get(String(row.rollnumber));
    const choice = choiceFromCastCode(row.cast_code);
    if (!bioguideId || !rollcall || !choice) return [];
    const year = String(rollcall.date || "").slice(0, 4);
    const clerkNumber = String(rollcall.clerk_rollnumber || "").trim();
    return [{
      bioguideId,
      voteId: `H119-${row.rollnumber}`,
      billNo: displayBillNumber(rollcall.bill_number),
      title: rollcall.vote_desc || rollcall.vote_question || "House roll call",
      voteDate: rollcall.date,
      choice,
      detailLink: year && clerkNumber ? `https://clerk.house.gov/Votes/${year}${clerkNumber}` : "",
    }];
  });

  const result = deriveVoteSimilarities(houseMembers, similarityRows, {
    memberIdField: "bioguideId", voteIdField: "voteId", yesChoice: "yes", noChoice: "no",
    minimumParticipants: 20, minimumMinorityShare: 0.1, minimumCommonVotes: 20,
  });
  const output = {
    congress: CONGRESS,
    basis: "divided_yes_no_votes",
    source: "Voteview Congressional Roll-Call Votes Database",
    dataThrough: result.dataThrough,
    qualifyingVoteCount: result.qualifyingVoteCount,
    members: Object.fromEntries([...result.members].map(([bioguideId, network]) => [bioguideId, {
      eligibleVoteCount: network.eligibleVoteCount,
      minimumMinorityShare: network.minimumMinorityShare,
      minimumCommonVotes: network.minimumCommonVotes,
      topMatches: network.topMatches.map((match) => ({
        bioguideId: match.memberId, sameParty: match.sameParty, agreementRate: match.agreementRate,
        commonVoteCount: match.commonVoteCount, agreementCount: match.agreementCount,
        disagreementCount: match.disagreementCount,
      })),
    }]))
  };
  const outputPath = path.join(projectRoot, "data", "us", "vote_similarity.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Voteview member rows: ${memberRows.length}`);
  console.log(`Voteview vote rows: ${voteRows.length}`);
  console.log(`Qualifying divided votes: ${result.qualifyingVoteCount}`);
  console.log(`Wrote file: ${outputPath}`);
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
