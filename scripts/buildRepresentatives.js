import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RECENT_VOTES_LIMIT = 10;
const RECENT_BILLS_LIMIT = 10;
const RECENT_ABSENT_VOTES_LIMIT = 100;

function readJson(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function toSortableDate(value) {
  if (!value) return 0;
  const onlyDigits = String(value).replace(/\D/g, "");
  if (!onlyDigits) return 0;
  return Number(onlyDigits);
}

function groupByMonaCode(rows) {
  const map = new Map();
  for (const row of rows) {
    const monaCode = String(row?.monaCode || "").trim();
    if (!monaCode) continue;
    const current = map.get(monaCode) || [];
    current.push(row);
    map.set(monaCode, current);
  }
  return map;
}

function buildRecentVotes(votes) {
  return [...votes]
    .sort((a, b) => toSortableDate(b.voteDate) - toSortableDate(a.voteDate))
    .slice(0, RECENT_VOTES_LIMIT)
    .map((v) => ({
      billId: v.billId || "",
      billNo: v.billNo || "",
      title: v.title || "",
      voteDate: v.voteDate || "",
      choice: v.choice || "",
    }));
}

function buildRecentAbsentVotes(votes) {
  return [...votes]
    .filter((v) => (v.choice || "").trim() === "불참")
    .sort((a, b) => toSortableDate(b.voteDate) - toSortableDate(a.voteDate))
    .slice(0, RECENT_ABSENT_VOTES_LIMIT)
    .map((v) => ({
      billId: v.billId || "",
      billNo: v.billNo || "",
      title: v.title || "",
      voteDate: v.voteDate || "",
      choice: v.choice || "",
    }));
}

function buildRecentBills(bills) {
  return [...bills]
    .sort((a, b) => toSortableDate(b.proposalDate) - toSortableDate(a.proposalDate))
    .slice(0, RECENT_BILLS_LIMIT)
    .map((b) => ({
      billId: b.billId || "",
      title: b.billTitle || "",
      proposalDate: b.proposalDate || "",
      billStatus: b.billStatus || "",
    }));
}

function round1(value) {
  return Number(value.toFixed(1));
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");

  const membersPath = path.join(projectRoot, "data", "members.json");
  const votesPath = path.join(projectRoot, "data", "raw", "votes_raw.json");
  const billsPath = path.join(projectRoot, "data", "raw", "bills_raw.json");

  const members = readJson(membersPath);
  const votes = readJson(votesPath);
  const bills = readJson(billsPath);

  const votesByMonaCode = groupByMonaCode(votes);
  const billsByMonaCode = groupByMonaCode(bills);

  const representatives = members.map((member) => {
    const monaCode = String(member?.monaCode || "").trim();
    const memberVotes = votesByMonaCode.get(monaCode) || [];
    const memberBills = billsByMonaCode.get(monaCode) || [];

    const votesTotal = memberVotes.length;
    const votesParticipated = memberVotes.filter((v) => (v.choice || "").trim() !== "불참").length;
    const supportCount = memberVotes.filter((v) => (v.choice || "").trim() === "찬성").length;
    const opposeCount = memberVotes.filter((v) => (v.choice || "").trim() === "반대").length;
    const abstainCount = memberVotes.filter((v) => (v.choice || "").trim() === "기권").length;
    const absentCount = Math.max(votesTotal - votesParticipated, 0);

    const voteParticipationRate =
      votesTotal > 0 ? round1((votesParticipated / votesTotal) * 100) : 0;
    const supportRate = votesParticipated > 0 ? round1((supportCount / votesParticipated) * 100) : 0;
    const opposeRate = votesParticipated > 0 ? round1((opposeCount / votesParticipated) * 100) : 0;
    const abstainRate = votesParticipated > 0 ? round1((abstainCount / votesParticipated) * 100) : 0;

    return {
      ...member,
      votesTotal,
      votesParticipated,
      voteParticipationRate,
      supportRate,
      opposeRate,
      abstainRate,
      absentCount,
      recentVotes: buildRecentVotes(memberVotes),
      recentAbsentVotes: buildRecentAbsentVotes(memberVotes),
      billsProposed: memberBills.length,
      recentBills: buildRecentBills(memberBills),
    };
  });

  const outDir = path.join(projectRoot, "data", "app");
  const outPath = path.join(outDir, "representatives.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(representatives, null, 2)}\n`, "utf8");

  console.log(`Members input: ${members.length}`);
  console.log(`Votes input rows: ${votes.length}`);
  console.log(`Bills input rows: ${bills.length}`);
  console.log(`Representatives output: ${representatives.length}`);
  console.log(`Wrote file: ${outPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
