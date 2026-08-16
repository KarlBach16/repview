import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { getBillLeadCodes } from "./lib/deriveRepresentativeMetrics.js";

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
  const billMemberProfiles = readJson(path.join(projectRoot, "data", "kr", "bills", "members.json"));
  const collaborationEvidence = readJson(path.join(projectRoot, "data", "kr", "collaboration_networks.json"));
  const voteSimilarity = readJson(path.join(projectRoot, "data", "kr", "vote_similarity.json"));
  const supporterAssociations = readJson(path.join(projectRoot, "data", "kr", "supporter_associations.json"));
  const memberBooks = readJson(path.join(projectRoot, "data", "kr", "member_books.json"));
  const executiveRoles = readJson(path.join(projectRoot, "data", "kr", "executive_roles.json"));
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
  const sponsorNameByCode = new Map();
  for (const bill of bills) {
    const billId = String(bill?.billId || "").trim();
    if (!billId) fail("Bill row has no billId");
    if (!String(bill?.billTitle || "").trim()) fail(`Bill row has no title: ${billId}`);
    if (!normalizedDate(bill?.proposalDate)) fail(`Bill row has invalid proposalDate: ${billId}`);
    if (seenBillIds.has(billId)) fail(`Duplicate bill row: ${billId}`);
    seenBillIds.add(billId);
    for (const leadCode of getBillLeadCodes(bill)) addCount(leadBillCounts, leadCode);

    for (const [codeField, nameField] of [["RST_MONA_CD", "RST_PROPOSER"], ["PUBL_MONA_CD", "PUBL_PROPOSER"]]) {
      const codes = String(bill?.source?.[codeField] || "").split(",").map((value) => value.trim()).filter(Boolean);
      const names = String(bill?.source?.[nameField] || "").split(",").map((value) => value.trim()).filter(Boolean);
      if (codes.length !== names.length) {
        fail(`Sponsor code/name count mismatch for ${billId}/${codeField}: ${codes.length} != ${names.length}`);
        continue;
      }
      codes.forEach((code, index) => {
        const name = names[index];
        const previousName = sponsorNameByCode.get(code);
        if (previousName && previousName !== name) fail(`Sponsor code reused by different names: ${code}/${previousName}/${name}`);
        sponsorNameByCode.set(code, name);
      });
    }
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
  const memberIds = new Set();
  const memberByCode = new Map();
  for (const member of members) {
    const code = String(member?.monaCode || "").trim();
    const id = String(member?.id || "").trim();
    if (!code) fail(`Current member has no monaCode: ${member?.name || "unknown"}`);
    if (!id) fail(`Current member has no id: ${member?.name || code || "unknown"}`);
    if (!String(member?.name || "").trim()) fail(`Current member has no name: ${code}`);
    if (!String(member?.party || "").trim()) fail(`Current member has no party: ${member?.name || code}`);
    if (memberCodes.has(code)) fail(`Duplicate current member code: ${code}`);
    if (memberIds.has(id)) fail(`Duplicate current member id: ${id}`);
    memberCodes.add(code);
    memberIds.add(id);
    memberByCode.set(code, member);
    const sponsorName = sponsorNameByCode.get(code);
    if (sponsorName && sponsorName !== member.name) {
      fail(`Current member name does not match bill sponsor identity: ${code}/${member.name}/${sponsorName}`);
    }
  }

  if (representatives.length !== members.length) {
    fail(`Representative output count ${representatives.length} does not match member count ${members.length}`);
  }
  const representativeCodes = new Set(representatives.map((rep) => String(rep?.monaCode || "").trim()));
  for (const code of memberCodes) {
    if (!representativeCodes.has(code)) fail(`Current member missing from representative output: ${code}`);
    const representative = representatives.find((rep) => String(rep?.monaCode || "").trim() === code);
    for (const field of ["id", "name", "party", "district", "photo", "homepage"]) {
      if (String(representative?.[field] || "") !== String(memberByCode.get(code)?.[field] || "")) {
        fail(`Representative identity mismatch for ${code}/${field}`);
      }
    }
    const billProfile = billMemberProfiles?.[code];
    for (const [memberField, profileField] of [["id", "slug"], ["name", "name"], ["party", "party"], ["district", "district"], ["photo", "photo"]]) {
      if (String(billProfile?.[profileField] || "") !== String(memberByCode.get(code)?.[memberField] || "")) {
        fail(`Bill member profile identity mismatch for ${code}/${profileField}`);
      }
    }
    const expectedVotes = memberVoteCounts.get(code) || 0;
    if (Number(representative?.votesTotal || 0) !== expectedVotes) {
      fail(`Representative vote denominator mismatch for ${code}: ${representative?.votesTotal} != ${expectedVotes}`);
    }
    const expectedBills = leadBillCounts.get(code) || 0;
    if (Number(representative?.billsProposed || 0) !== expectedBills) {
      fail(`Representative bill count mismatch for ${code}: ${representative?.billsProposed} != ${expectedBills}`);
    }

    const network = collaborationEvidence?.members?.[code];
    if (!network) {
      fail(`Current member missing collaboration network: ${code}`);
      continue;
    }
    if (!Array.isArray(network.topCollaborators) || network.topCollaborators.length > 5) {
      fail(`Invalid top collaborators for ${code}`);
      continue;
    }
    const collaboratorCodes = new Set();
    for (const collaborator of network.topCollaborators) {
      const collaboratorCode = String(collaborator?.monaCode || "").trim();
      if (!memberCodes.has(collaboratorCode) || collaboratorCode === code) {
        fail(`Invalid collaborator ${collaboratorCode || "missing"} for ${code}`);
      }
      if (collaboratorCodes.has(collaboratorCode)) {
        fail(`Duplicate collaborator ${collaboratorCode} for ${code}`);
      }
      collaboratorCodes.add(collaboratorCode);
      if (Number(collaborator?.billCount || 0) <= 0) {
        fail(`Invalid collaboration count for ${code}/${collaboratorCode}`);
      }
      if (!Array.isArray(collaborator?.sharedBillIds) || collaborator.sharedBillIds.length > 4) {
        fail(`Invalid shared bills for ${code}/${collaboratorCode}`);
        continue;
      }
      for (const billId of collaborator.sharedBillIds) {
        const sharedBill = collaborationEvidence?.bills?.[billId];
        if (!sharedBill) fail(`Missing shared bill ${billId} for ${code}/${collaboratorCode}`);
        if (!String(sharedBill?.title || "").trim()) fail(`Shared bill has no title: ${billId}`);
        if (!normalizedDate(sharedBill?.proposalDate)) fail(`Shared bill has invalid date: ${billId}`);
      }
    }
    if (!Array.isArray(network.topOtherPartyCollaborators) || network.topOtherPartyCollaborators.length > 5) {
      fail(`Invalid top other-party collaborators for ${code}`);
    } else {
      const otherPartyCodes = new Set();
      for (const collaborator of network.topOtherPartyCollaborators) {
        const collaboratorCode = String(collaborator?.monaCode || "").trim();
        if (!memberCodes.has(collaboratorCode) || collaboratorCode === code || collaborator.sameParty) {
          fail(`Invalid other-party collaborator ${collaboratorCode || "missing"} for ${code}`);
        }
        if (otherPartyCodes.has(collaboratorCode)) {
          fail(`Duplicate other-party collaborator ${collaboratorCode} for ${code}`);
        }
        otherPartyCodes.add(collaboratorCode);
        if (Number(collaborator?.billCount || 0) <= 0) {
          fail(`Invalid other-party collaboration count for ${code}/${collaboratorCode}`);
        }
        if (!Array.isArray(collaborator?.sharedBillIds) || collaborator.sharedBillIds.length > 4) {
          fail(`Invalid other-party shared bills for ${code}/${collaboratorCode}`);
          continue;
        }
        for (const billId of collaborator.sharedBillIds) {
          if (!collaborationEvidence?.bills?.[billId]) {
            fail(`Missing other-party shared bill ${billId} for ${code}/${collaboratorCode}`);
          }
        }
      }
    }

    const similarity = voteSimilarity?.members?.[code];
    if (!similarity || !Array.isArray(similarity.topMatches) || similarity.topMatches.length > 5) {
      fail(`Current member missing vote similarity: ${code}`);
    } else {
      const matchedCodes = new Set();
      for (const match of similarity.topMatches) {
        const matchedCode = String(match?.monaCode || "").trim();
        if (!memberCodes.has(matchedCode) || matchedCode === code || matchedCodes.has(matchedCode)) {
          fail(`Invalid vote similarity match ${matchedCode || "missing"} for ${code}`);
        }
        matchedCodes.add(matchedCode);
        if (Number(match?.commonVoteCount || 0) < Number(similarity.minimumCommonVotes || 0)) {
          fail(`Vote similarity overlap too low for ${code}/${matchedCode}`);
        }
        if (Number(match?.agreementRate) < 0 || Number(match?.agreementRate) > 100) {
          fail(`Invalid agreement rate for ${code}/${matchedCode}`);
        }
      }
    }
  }

  if (voteSimilarity?.basis !== "divided_yes_no_votes" || !normalizedDate(voteSimilarity?.dataThrough)) {
    fail("Invalid vote similarity metadata");
  }
  const supporterRows = Object.entries(supporterAssociations?.members || {});
  if (supporterRows.length < members.length - 5) fail(`Supporter association coverage too low: ${supporterRows.length}`);
  const supporterSources = new Map();
  for (const [code, supporter] of supporterRows) {
    if (!memberCodes.has(code) || !supporter?.associationName || !/^https:\/\/www\.give\.go\.kr\//.test(supporter?.sourceUrl || "")) {
      fail(`Invalid supporter association: ${code}`);
    }
    const sourceUrl = String(supporter?.sourceUrl || "").trim();
    if (sourceUrl && supporterSources.has(sourceUrl)) {
      fail(`Supporter association source reused by ${supporterSources.get(sourceUrl)} and ${code}: ${sourceUrl}`);
    }
    if (sourceUrl) supporterSources.set(sourceUrl, code);
    const supporterName = String(supporter?.associationName || "")
      .replace(/^국회의원/, "").replace(/후원회$/, "").replace(/[\s·]/g, "");
    const memberName = String(memberByCode.get(code)?.name || "").replace(/[\s·]/g, "");
    if (supporterName !== memberName) fail(`Supporter association name mismatch for ${code}: ${supporterName}/${memberName}`);
  }
  for (const role of executiveRoles) {
    const code = String(role?.monaCode || "").trim();
    if (!memberCodes.has(code) || String(memberByCode.get(code)?.name || "") !== String(role?.name || "")) {
      fail(`Executive role identity mismatch: ${code || "missing code"}/${role?.name || "missing name"}`);
    }
  }
  for (const [code, books] of Object.entries(memberBooks?.members || {})) {
    if (!memberCodes.has(code) || !Array.isArray(books) || !books.length || books.length > 3) fail(`Invalid member books: ${code}`);
    for (const book of books || []) {
      if (!String(book?.title || "").trim() || !/^\d{4}$/.test(String(book?.year || ""))) fail(`Invalid book record: ${code}`);
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
  console.log(`- collaboration networks: ${Object.keys(collaborationEvidence?.members || {}).length}`);
  console.log(`- vote similarity networks: ${Object.keys(voteSimilarity?.members || {}).length}`);
  console.log(`- supporter associations: ${supporterRows.length}`);
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
