import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ALLOWED_CHOICES = new Set(["찬성", "반대", "기권", "불참"]);
const REQUIRED_VOTE_FIELDS = ["monaCode", "party", "billId", "billNo", "title", "voteDate", "choice"];

function readJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readGzipJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  return JSON.parse(gunzipSync(readFileSync(filePath)).toString("utf8"));
}

function normalizedDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}

function addCount(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function main() {
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(__filename), "..");
  const votes = readGzipJson(path.join(projectRoot, "data", "raw", "votes_raw.json.gz"));
  const summaries = readGzipJson(path.join(projectRoot, "data", "raw", "vote_summaries.json.gz"));
  const bills = readJson(path.join(projectRoot, "data", "raw", "bills_raw.json"));
  const members = readJson(path.join(projectRoot, "data", "members.json"));
  const representatives = readJson(path.join(projectRoot, "data", "app", "representatives.json"));
  const sentinels = readJson(path.join(projectRoot, "data", "kr", "vote_sentinels.json"));

  const failures = [];
  const warnings = [];
  const fail = (message) => failures.push(message);
  const warn = (message) => warnings.push(message);

  if (!Array.isArray(votes) || votes.length < 300000) {
    fail(`Vote rows below safety floor: ${Array.isArray(votes) ? votes.length : "not an array"}`);
  }
  if (!Array.isArray(summaries) || summaries.length < 1000) {
    fail(`Vote summaries below safety floor: ${Array.isArray(summaries) ? summaries.length : "not an array"}`);
  }
  if (!Array.isArray(bills) || bills.length < 10000) {
    fail(`Bill rows below safety floor: ${Array.isArray(bills) ? bills.length : "not an array"}`);
  }
  if (!Array.isArray(members) || members.length < 250 || members.length > 350) {
    fail(`Current member count outside expected range: ${Array.isArray(members) ? members.length : "not an array"}`);
  }

  const summaryByBill = new Map();
  let latestSummaryDate = "";
  for (const summary of summaries) {
    const billId = String(summary?.billId || "").trim();
    if (!billId) {
      fail("Vote summary has no billId");
      continue;
    }
    if (summaryByBill.has(billId)) fail(`Duplicate vote summary: ${billId}`);
    summaryByBill.set(billId, summary);

    const aggregateTotal = Number(summary.yesCount || 0) + Number(summary.noCount || 0) + Number(summary.abstainCount || 0);
    if (aggregateTotal !== Number(summary.voteCount || 0)) {
      fail(`Aggregate tally does not equal voteCount for ${billId}: ${aggregateTotal} != ${summary.voteCount}`);
    }
    const processedDate = normalizedDate(summary.processedDate);
    if (!processedDate) fail(`Vote summary has invalid processedDate: ${billId}`);
    if (processedDate > latestSummaryDate) latestSummaryDate = processedDate;
  }

  const voteRowsByBill = new Map();
  const choiceCountsByBill = new Map();
  const memberVoteCounts = new Map();
  const seenMemberBill = new Set();
  let latestVoteDate = "";

  const seenBillIds = new Set();
  const leadBillCounts = new Map();
  for (const bill of bills) {
    const billId = String(bill?.billId || "").trim();
    if (!billId) fail("Bill row has no billId");
    if (!String(bill?.billTitle || "").trim()) fail(`Bill row has no title: ${billId}`);
    if (!normalizedDate(bill?.proposalDate)) fail(`Bill row has invalid proposalDate: ${billId}`);
    if (seenBillIds.has(billId)) fail(`Duplicate bill row: ${billId}`);
    seenBillIds.add(billId);
    const leadCode = String(bill?.monaCode || "").trim();
    if (leadCode) addCount(leadBillCounts, leadCode);
  }

  for (const vote of votes) {
    for (const field of REQUIRED_VOTE_FIELDS) {
      if (!String(vote?.[field] || "").trim()) fail(`Vote row missing ${field}: ${vote?.billId || "unknown bill"}`);
    }

    const billId = String(vote?.billId || "").trim();
    const monaCode = String(vote?.monaCode || "").trim();
    const choice = String(vote?.choice || "").trim();
    if (!ALLOWED_CHOICES.has(choice)) fail(`Unknown vote choice '${choice}' for ${billId}/${monaCode}`);
    if (!summaryByBill.has(billId)) fail(`Member vote references unknown official summary: ${billId}`);

    const uniqueKey = `${billId}|${monaCode}`;
    if (seenMemberBill.has(uniqueKey)) fail(`Duplicate member vote: ${uniqueKey}`);
    seenMemberBill.add(uniqueKey);

    addCount(voteRowsByBill, billId);
    addCount(memberVoteCounts, monaCode);
    const choiceCounts = choiceCountsByBill.get(billId) || { "찬성": 0, "반대": 0, "기권": 0, "불참": 0 };
    choiceCounts[choice] += 1;
    choiceCountsByBill.set(billId, choiceCounts);

    const voteDate = normalizedDate(vote.voteDate);
    if (!voteDate) fail(`Vote row has invalid date: ${billId}/${monaCode}`);
    if (voteDate > latestVoteDate) latestVoteDate = voteDate;
  }

  let tallyMismatchCount = 0;
  let memberRowMismatchCount = 0;
  let largestParticipatingGap = 0;
  for (const [billId, summary] of summaryByBill) {
    const rowCount = voteRowsByBill.get(billId) || 0;
    if (rowCount === 0) {
      fail(`Official voted bill has no member rows: ${billId}`);
      continue;
    }

    const counts = choiceCountsByBill.get(billId);
    const rawParticipating = counts["찬성"] + counts["반대"] + counts["기권"];
    const participatingGap = Number(summary.voteCount || 0) - rawParticipating;
    if (participatingGap !== 0) {
      tallyMismatchCount += 1;
      largestParticipatingGap = Math.max(largestParticipatingGap, Math.abs(participatingGap));
    }
    if (participatingGap < 0) {
      fail(`Member vote tally exceeds aggregate voteCount for ${billId}: ${rawParticipating} > ${summary.voteCount}`);
    }
    const allowedGap = Math.max(25, Math.ceil(Number(summary.voteCount || 0) * 0.2));
    if (participatingGap > allowedGap) {
      fail(`Member vote tally is too far below aggregate for ${billId}: gap ${participatingGap}, allowed ${allowedGap}`);
    }

    if (rowCount !== Number(summary.memberCount || 0)) memberRowMismatchCount += 1;
    if (rowCount > Number(summary.memberCount || 0)) {
      fail(`Member rows exceed official memberCount for ${billId}: ${rowCount} > ${summary.memberCount}`);
    }
  }

  if (latestVoteDate !== latestSummaryDate) {
    fail(`Latest member vote date ${latestVoteDate} does not match latest official summary date ${latestSummaryDate}`);
  }

  const memberCodes = new Set();
  for (const member of members) {
    const code = String(member?.monaCode || "").trim();
    if (!code) fail(`Current member has no monaCode: ${member?.name || "unknown"}`);
    if (!String(member?.name || "").trim()) fail(`Current member has no name: ${code}`);
    if (!String(member?.party || "").trim()) fail(`Current member has no party: ${member?.name || code}`);
    if (memberCodes.has(code)) fail(`Duplicate current member code: ${code}`);
    memberCodes.add(code);
  }

  if (representatives.length !== members.length) {
    fail(`Representative output count ${representatives.length} does not match member count ${members.length}`);
  }
  const representativeCodes = new Set(representatives.map((rep) => String(rep?.monaCode || "").trim()));
  for (const code of memberCodes) {
    if (!representativeCodes.has(code)) fail(`Current member missing from representative output: ${code}`);
    const representative = representatives.find((rep) => String(rep?.monaCode || "").trim() === code);
    const expectedVotes = memberVoteCounts.get(code) || 0;
    if (Number(representative?.votesTotal || 0) !== expectedVotes) {
      fail(`Representative vote denominator mismatch for ${code}: ${representative?.votesTotal} != ${expectedVotes}`);
    }
    const expectedBills = leadBillCounts.get(code) || 0;
    if (Number(representative?.billsProposed || 0) !== expectedBills) {
      fail(`Representative bill count mismatch for ${code}: ${representative?.billsProposed} != ${expectedBills}`);
    }
  }

  const noVoteMembers = members.filter((member) => !memberVoteCounts.has(String(member?.monaCode || "").trim()));
  if (noVoteMembers.length) {
    warn(`Current members with no roll-call rows (${noVoteMembers.length}): ${noVoteMembers.map((member) => member.name).join(", ")}`);
  }

  const representativeByCode = new Map(
    representatives.map((rep) => [String(rep?.monaCode || "").trim(), rep])
  );
  for (const sentinel of sentinels) {
    const rawVote = votes.find(
      (vote) => vote.billId === sentinel.billId && vote.monaCode === sentinel.memberCode
    );
    if (!rawVote) {
      fail(`Sentinel missing raw vote: ${sentinel.label}`);
      continue;
    }
    if (rawVote.choice !== sentinel.choice) {
      fail(`Sentinel choice changed for ${sentinel.label}: ${rawVote.choice} != ${sentinel.choice}`);
    }

    const summary = summaryByBill.get(sentinel.billId);
    for (const [field, expected] of Object.entries(sentinel.summary || {})) {
      if (Number(summary?.[field]) !== Number(expected)) {
        fail(`Sentinel summary changed for ${sentinel.label}/${field}: ${summary?.[field]} != ${expected}`);
      }
    }

    const representative = representativeByCode.get(sentinel.memberCode);
    const derivedVote = representative?.partyComparison?.votes?.find(
      (vote) => vote.billId === sentinel.billId
    );
    if (!derivedVote) {
      fail(`Sentinel missing derived party comparison: ${sentinel.label}`);
      continue;
    }
    if (derivedVote.partyMajorityChoice !== sentinel.partyMajorityChoice) {
      fail(`Sentinel party majority changed for ${sentinel.label}`);
    }
    for (const [field, expected] of Object.entries(sentinel.partyDistribution || {})) {
      if (Number(derivedVote.partyDistribution?.[field]) !== Number(expected)) {
        fail(`Sentinel party distribution changed for ${sentinel.label}/${field}: ${derivedVote.partyDistribution?.[field]} != ${expected}`);
      }
    }
  }

  if (tallyMismatchCount > 0) {
    warn(`Official aggregate/member API tally mismatches: ${tallyMismatchCount} bills; largest participating gap ${largestParticipatingGap}`);
  }
  if (memberRowMismatchCount > 0) {
    warn(`Official memberCount/member-row mismatches: ${memberRowMismatchCount} bills`);
  }

  console.log("Data quality audit");
  console.log(`- current members: ${members.length}`);
  console.log(`- official voted bills: ${summaries.length}`);
  console.log(`- member vote rows: ${votes.length}`);
  console.log(`- member-sponsored bills: ${bills.length}`);
  console.log(`- latest vote date: ${latestVoteDate}`);
  console.log(`- sentinels checked: ${sentinels.length}`);
  for (const message of warnings) console.warn(`WARN: ${message}`);

  if (failures.length) {
    for (const message of failures.slice(0, 50)) console.error(`FAIL: ${message}`);
    if (failures.length > 50) console.error(`FAIL: ...and ${failures.length - 50} more`);
    throw new Error(`Data quality audit failed with ${failures.length} issue(s).`);
  }

  console.log("Data quality audit passed.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
