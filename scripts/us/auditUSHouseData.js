import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  throw new Error(`US data audit failed: ${message}`);
}

function isNonNegativeNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(__filename), "..", "..");
  const membersPath = path.join(projectRoot, "data", "us", "house_members.json");
  const members = JSON.parse(await readFile(membersPath, "utf8"));

  if (!Array.isArray(members) || members.length < 400 || members.length > 435) {
    fail(`unexpected voting-member count: ${members?.length ?? "invalid"}`);
  }

  const districtCodes = new Set();
  let financeCount = 0;
  let recentVoteCount = 0;

  for (const member of members) {
    if (!member.bioguideId || !member.districtCode) fail(`missing identity fields for ${member.name || "unknown"}`);
    if (districtCodes.has(member.districtCode)) fail(`duplicate district: ${member.districtCode}`);
    districtCodes.add(member.districtCode);

    if (!Array.isArray(member.fecCandidateIds) || !member.fecCandidateIds.length) {
      fail(`missing FEC candidate ID: ${member.name}`);
    }

    const finance = member.campaignFinance;
    if (finance) {
      financeCount += 1;
      for (const field of [
        "totalReceipts",
        "individualContributions",
        "pacContributions",
        "candidateFunding",
        "totalDisbursements",
        "cashOnHand",
      ]) {
        if (!isNonNegativeNumber(finance[field])) fail(`invalid ${field}: ${member.name}`);
      }
      if (!/^https:\/\/www\.fec\.gov\//.test(finance.sourceUrl || "")) fail(`invalid FEC source: ${member.name}`);
    }

    const voteIds = new Set();
    if (!isNonNegativeNumber(member.partyDifferentVotesCount)) {
      fail(`invalid party-different vote count: ${member.name}`);
    }
    if (!isNonNegativeNumber(member.partyComparableVotesCount)) {
      fail(`invalid comparable vote count: ${member.name}`);
    }
    if (Number(member.partyDifferentVotesCount) > Number(member.partyComparableVotesCount)) {
      fail(`party-different count exceeds comparable votes: ${member.name}`);
    }
    for (const vote of member.recentVotes || []) {
      recentVoteCount += 1;
      if (!vote.voteId || voteIds.has(vote.voteId)) fail(`duplicate recent vote for ${member.name}: ${vote.voteId}`);
      voteIds.add(vote.voteId);
      if (!vote.voteKind || !vote.voteKindLabel) fail(`missing vote type for ${member.name}: ${vote.voteId}`);
      if (!/^https:\/\/clerk\.house\.gov\/Votes\//.test(vote.voteUrl || "")) {
        fail(`invalid roll-call URL for ${member.name}: ${vote.voteId}`);
      }
      if (vote.billNo && !vote.billNo.startsWith("House Vote") && !/^https:\/\/www\.congress\.gov\/bill\//.test(vote.billUrl || "")) {
        fail(`invalid bill URL for ${member.name}: ${vote.voteId}`);
      }
    }
  }

  if (financeCount < Math.floor(members.length * 0.95)) {
    fail(`campaign-finance coverage too low: ${financeCount}/${members.length}`);
  }
  if (recentVoteCount < members.length * 5) fail(`recent vote coverage too low: ${recentVoteCount}`);

  const sentinelVotes = new Map(
    (members.find((member) => member.districtCode === "AK-AL")?.recentVotes || [])
      .map((vote) => [vote.voteId, vote])
  );
  if (sentinelVotes.get("h273")?.voteKind !== "amendment") fail("h273 must be classified as an amendment");
  if (sentinelVotes.get("h277")?.voteKind !== "recommit") fail("h277 must be classified as a motion to recommit");
  if (sentinelVotes.get("h278")?.voteKind !== "passage") fail("h278 must be classified as final passage");

  console.log(`US data audit passed: ${members.length} members`);
  console.log(`Campaign-finance coverage: ${financeCount}/${members.length}`);
  console.log(`Recent vote rows audited: ${recentVoteCount}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
