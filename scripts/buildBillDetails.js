import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const SHARD_COUNT = 32;

function readJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readGzipJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  return JSON.parse(gunzipSync(readFileSync(filePath)).toString("utf8"));
}

function clean(value) {
  return String(value || "").trim();
}

function splitCodes(value) {
  return clean(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function splitNames(value) {
  return clean(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function shardForBillId(value) {
  let hash = 0;
  for (const char of clean(value)) hash = (hash + char.charCodeAt(0)) % SHARD_COUNT;
  return String(hash).padStart(2, "0");
}

function normalizedStatus(value, voteResult = "") {
  const raw = clean(value || voteResult);
  if (raw === "원안가결" || raw === "수정가결") return raw;
  if (raw === "대안반영폐기" || raw === "수정안반영폐기") return raw;
  if (raw === "철회" || raw === "폐기" || raw === "부결") return raw;
  if (raw.includes("가결")) return raw;
  return raw || "계류";
}

function buildVoteDetail(summary, memberVotes = []) {
  const members = { yes: [], no: [], abstain: [], unrecorded: [] };
  const partyMap = new Map();
  const choiceKey = { "찬성": "yes", "반대": "no", "기권": "abstain", "미표결": "unrecorded" };
  for (const vote of memberVotes) {
    const key = choiceKey[vote.choice];
    if (!key) continue;
    if (vote.code) members[key].push(vote.code);
    const party = vote.party || "기타";
    const counts = partyMap.get(party) || { party, yes: 0, no: 0, abstain: 0, unrecorded: 0 };
    counts[key] += 1;
    partyMap.set(party, counts);
  }
  return {
    date: clean(summary.processedDate),
    result: clean(summary.result),
    memberCount: Number(summary.memberCount || 0),
    voteCount: Number(summary.voteCount || 0),
    yes: Number(summary.yesCount || 0),
    no: Number(summary.noCount || 0),
    abstain: Number(summary.abstainCount || 0),
    unrecorded: Math.max(Number(summary.memberCount || 0) - Number(summary.voteCount || 0), 0),
    parties: [...partyMap.values()].sort((a, b) => (
      (b.yes + b.no + b.abstain + b.unrecorded) - (a.yes + a.no + a.abstain + a.unrecorded)
    )),
    members,
  };
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(__filename), "..");
  const bills = readJson(path.join(projectRoot, "data", "raw", "bills_raw.json"));
  const votes = readGzipJson(path.join(projectRoot, "data", "raw", "votes_raw.json.gz"));
  const summaries = readGzipJson(path.join(projectRoot, "data", "raw", "vote_summaries.json.gz"));
  const members = readJson(path.join(projectRoot, "data", "members.json"));
  const profiles = Object.fromEntries(members.map((member) => [clean(member.monaCode), {
    code: clean(member.monaCode),
    slug: clean(member.id),
    name: clean(member.name),
    party: clean(member.party),
    district: clean(member.district),
    photo: clean(member.photo),
  }]));

  function registerNames(codes, names) {
    codes.forEach((code, index) => {
      if (!code || profiles[code]) return;
      profiles[code] = { code, slug: "", name: names[index] || "", party: "", district: "", photo: "" };
    });
  }

  const summaryByBill = new Map(summaries.map((summary) => [clean(summary.billId), summary]));
  const votesByBill = new Map();
  for (const vote of votes) {
    const billId = clean(vote.billId);
    if (!billId) continue;
    const rows = votesByBill.get(billId) || [];
    rows.push({
      code: clean(vote.monaCode),
      party: clean(vote.party),
      choice: clean(vote.choice) === "불참" ? "미표결" : clean(vote.choice),
    });
    votesByBill.set(billId, rows);
  }

  const billById = new Map();
  for (const bill of bills) {
    const source = bill.source || {};
    const billId = clean(bill.billId);
    if (!billId) continue;
    const summary = summaryByBill.get(billId);
    const leadCodes = splitCodes(source.RST_MONA_CD || bill.monaCode);
    const leadNames = splitNames(source.RST_PROPOSER || bill.memberName);
    const cosponsorCodes = splitCodes(source.PUBL_MONA_CD).filter((code) => !leadCodes.includes(code));
    const cosponsorNames = splitNames(source.PUBL_PROPOSER);
    registerNames(leadCodes, leadNames);
    registerNames(cosponsorCodes, cosponsorNames);
    billById.set(billId, {
      id: billId,
      no: clean(source.BILL_NO || summary?.billNo),
      title: clean(bill.billTitle || summary?.title),
      proposalDate: clean(bill.proposalDate),
      status: normalizedStatus(bill.billStatus, summary?.result),
      committee: clean(source.COMMITTEE),
      proposerLabel: leadCodes.length ? "" : clean(source.PROPOSER || bill.memberName),
      leadCodes,
      cosponsorCodes,
      timeline: {
        committeeDate: clean(source.COMMITTEE_DT),
        committeePresentedDate: clean(source.CMT_PRESENT_DT),
        committeeProcessedDate: clean(source.CMT_PROC_DT),
        plenaryPresentedDate: clean(source.LAW_PRESENT_DT || source.LAW_SUBMIT_DT),
        plenaryProcessedDate: clean(source.LAW_PROC_DT || summary?.processedDate || source.PROC_DT),
      },
      officialUrl: clean(bill.detailLink || summary?.linkUrl),
      vote: summary ? buildVoteDetail(summary, votesByBill.get(billId) || []) : null,
    });
  }

  for (const summary of summaries) {
    const billId = clean(summary.billId);
    if (!billId || billById.has(billId)) continue;
    billById.set(billId, {
      id: billId,
      no: clean(summary.billNo),
      title: clean(summary.title),
      proposalDate: "",
      status: normalizedStatus("", summary.result),
      committee: "",
      proposerLabel: "",
      leadCodes: [],
      cosponsorCodes: [],
      timeline: {
        committeeDate: "",
        committeePresentedDate: "",
        committeeProcessedDate: "",
        plenaryPresentedDate: "",
        plenaryProcessedDate: clean(summary.processedDate),
      },
      officialUrl: clean(summary.linkUrl),
      vote: buildVoteDetail(summary, votesByBill.get(billId) || []),
    });
  }

  const outputDir = path.join(projectRoot, "data", "kr", "bills");
  await mkdir(outputDir, { recursive: true });
  const shards = Array.from({ length: SHARD_COUNT }, () => ({}));
  for (const bill of billById.values()) {
    const index = Number(shardForBillId(bill.id));
    shards[index][bill.id] = bill;
  }
  await Promise.all(shards.map((shard, index) => (
    writeJsonAtomic(path.join(outputDir, `${String(index).padStart(2, "0")}.json`), shard)
  )));

  await writeJsonAtomic(path.join(outputDir, "members.json"), profiles);

  const latestBillDate = [...billById.values()].reduce(
    (latest, bill) => bill.proposalDate > latest ? bill.proposalDate : latest,
    ""
  );
  const latestVoteDate = summaries.reduce(
    (latest, summary) => clean(summary.processedDate) > latest ? clean(summary.processedDate) : latest,
    ""
  );
  await writeJsonAtomic(path.join(outputDir, "manifest.json"), {
    assembly: 22,
    shardCount: SHARD_COUNT,
    billCount: billById.size,
    latestBillDate,
    latestVoteDate,
  });

  console.log(`Bill details: ${billById.size}`);
  console.log(`Bill shards: ${SHARD_COUNT}`);
  console.log(`Bill member profiles: ${Object.keys(profiles).length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
