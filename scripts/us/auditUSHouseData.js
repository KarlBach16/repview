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
  const voteEvidencePath = path.join(projectRoot, "data", "us", "vote_evidence.json");
  const collaborationPath = path.join(projectRoot, "data", "us", "collaboration_networks.json");
  const members = JSON.parse(await readFile(membersPath, "utf8"));
  const voteEvidence = JSON.parse(await readFile(voteEvidencePath, "utf8"));
  const collaboration = JSON.parse(await readFile(collaborationPath, "utf8"));

  if (!Array.isArray(members) || members.length < 400 || members.length > 435) {
    fail(`unexpected voting-member count: ${members?.length ?? "invalid"}`);
  }

  const districtCodes = new Set();
  let financeCount = 0;
  let recentVoteCount = 0;
  let partyBreakVoteCount = 0;
  let collaborationRows = 0;

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
      const contributors = finance.topCommitteeContributors;
      if (!Array.isArray(contributors) || contributors.length > 5) fail(`invalid committee contributors: ${member.name}`);
      const committeeIds = new Set();
      for (const contributor of contributors) {
        if (!/^C\d{8}$/.test(contributor.committeeId || "")) fail(`invalid contributor committee ID: ${member.name}`);
        if (committeeIds.has(contributor.committeeId)) fail(`duplicate contributor committee: ${member.name}`);
        committeeIds.add(contributor.committeeId);
        if (!contributor.name || !isNonNegativeNumber(contributor.amount) || Number(contributor.amount) <= 0) {
          fail(`invalid contributor amount: ${member.name}`);
        }
        if (!/^https:\/\/www\.fec\.gov\/data\/committee\//.test(contributor.sourceUrl || "")) {
          fail(`invalid contributor source: ${member.name}`);
        }
      }
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

    const memberEvidence = voteEvidence?.members?.[member.bioguideId];
    if (!memberEvidence || typeof memberEvidence !== "object") fail(`missing vote evidence: ${member.name}`);

    const network = collaboration?.members?.[member.bioguideId];
    if (!network || typeof network !== "object") fail(`missing collaboration network: ${member.name}`);
    for (const field of [
      "collaborationBillCount",
      "uniqueCollaboratorCount",
      "otherPartyCollaboratorCount",
      "crossPartyBillCount",
    ]) {
      if (!isNonNegativeNumber(network[field])) fail(`invalid ${field}: ${member.name}`);
    }
    if (!Array.isArray(network.topCollaborators) || network.topCollaborators.length > 5) {
      fail(`invalid top collaborators: ${member.name}`);
    }
    const collaboratorIds = new Set();
    for (const collaborator of network.topCollaborators) {
      collaborationRows += 1;
      if (!collaborator.bioguideId || collaboratorIds.has(collaborator.bioguideId)) {
        fail(`duplicate collaborator: ${member.name}`);
      }
      collaboratorIds.add(collaborator.bioguideId);
      if (!members.some((row) => row.bioguideId === collaborator.bioguideId)) {
        fail(`unknown collaborator: ${member.name}/${collaborator.bioguideId}`);
      }
      if (!isNonNegativeNumber(collaborator.billCount) || Number(collaborator.billCount) <= 0) {
        fail(`invalid collaboration count: ${member.name}/${collaborator.bioguideId}`);
      }
      if (!Array.isArray(collaborator.sharedBillIds) || collaborator.sharedBillIds.length > 4) {
        fail(`invalid shared bills: ${member.name}/${collaborator.bioguideId}`);
      }
      for (const billId of collaborator.sharedBillIds) {
        const bill = collaboration?.bills?.[billId];
        if (!bill?.title || !/^https:\/\/www\.congress\.gov\/bill\/.+\/text$/.test(bill?.detailLink || "")) {
          fail(`invalid shared bill: ${member.name}/${billId}`);
        }
      }
    }
    const partyBreakRefs = memberEvidence.partyBreaks;
    if (!Array.isArray(partyBreakRefs)) fail(`missing party-break evidence: ${member.name}`);
    if (partyBreakRefs.length !== Number(member.partyDifferentVotesCount)) {
      fail(`party-break evidence count mismatch: ${member.name} (${partyBreakRefs.length}/${member.partyDifferentVotesCount})`);
    }
    const partyBreakIds = new Set();
    for (const ref of partyBreakRefs) {
      partyBreakVoteCount += 1;
      const vote = voteEvidence?.votes?.[ref?.voteKey];
      if (!vote) fail(`party-break vote reference missing: ${member.name}`);
      const voteKey = String(vote.voteUrl || "") || `${vote.voteDate}|${vote.voteId}`;
      if (!vote.voteId || partyBreakIds.has(voteKey)) fail(`duplicate party-break vote: ${member.name}`);
      partyBreakIds.add(voteKey);
      if (ref.choice !== "Yes" && ref.choice !== "No") fail(`invalid party-break choice: ${member.name}`);
      if (!vote.voteKind || !vote.voteKindLabel) fail(`missing party-break type: ${member.name}`);
    }

    for (const field of ["houseVotes", "sponsoredBills", "campaignFinance"]) {
      const value = member.dataAsOf?.[field];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) fail(`invalid ${field} data date: ${member.name}`);
    }
    for (const [listName, refs] of [
      ["final", memberEvidence.final],
      ["preliminary", memberEvidence.preliminary],
    ]) {
      if (!Array.isArray(refs)) fail(`missing recent ${listName} votes: ${member.name}`);
      for (const ref of refs) {
        recentVoteCount += 1;
        const vote = voteEvidence?.votes?.[ref?.voteKey];
        if (!vote) fail(`recent ${listName} vote reference missing: ${member.name}`);
        const voteKey = String(vote.voteUrl || "") || `${vote.voteDate}|${vote.voteId}`;
        if (!vote.voteId || voteIds.has(voteKey)) fail(`duplicate recent vote for ${member.name}: ${vote.voteId}`);
        voteIds.add(voteKey);
        if (listName === "final" && vote.isFinalPassage !== true) fail(`non-final vote in final list: ${member.name}`);
        if (listName === "preliminary" && vote.isFinalPassage === true) fail(`final vote in preliminary list: ${member.name}`);
        if (!vote.voteKind || !vote.voteKindLabel) fail(`missing vote type for ${member.name}: ${vote.voteId}`);
        if (!/^https:\/\/clerk\.house\.gov\/Votes\//.test(vote.voteUrl || "")) {
          fail(`invalid roll-call URL for ${member.name}: ${vote.voteId}`);
        }
        if (vote.billNo && !vote.billNo.startsWith("House Vote") && !/^https:\/\/www\.congress\.gov\/bill\//.test(vote.billUrl || "")) {
          fail(`invalid bill URL for ${member.name}: ${vote.voteId}`);
        }
      }
    }
  }

  if (financeCount < Math.floor(members.length * 0.95)) {
    fail(`campaign-finance coverage too low: ${financeCount}/${members.length}`);
  }
  if (recentVoteCount < members.length * 5) fail(`recent vote coverage too low: ${recentVoteCount}`);
  if (collaboration?.congress !== 119 || collaboration?.basis !== "official_billstatus_cosponsorship_roster") {
    fail("invalid collaboration metadata");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collaboration?.dataThrough || "")) fail("invalid collaboration data date");
  if (collaborationRows < members.length * 4) fail(`collaboration coverage too low: ${collaborationRows}`);

  const sentinelVotes = new Map(
    (() => {
      const member = members.find((row) => row.districtCode === "AK-AL");
      const evidence = voteEvidence?.members?.[member?.bioguideId] || {};
      return [...(evidence.final || []), ...(evidence.preliminary || [])]
        .map((ref) => voteEvidence?.votes?.[ref.voteKey])
        .filter(Boolean)
        .map((vote) => [vote.voteId, vote]);
    })()
  );
  if (sentinelVotes.get("h273")?.voteKind !== "amendment") fail("h273 must be classified as an amendment");
  if (sentinelVotes.get("h277")?.voteKind !== "recommit") fail("h277 must be classified as a motion to recommit");
  if (sentinelVotes.get("h278")?.voteKind !== "passage") fail("h278 must be classified as final passage");

  console.log(`US data audit passed: ${members.length} members`);
  console.log(`Campaign-finance coverage: ${financeCount}/${members.length}`);
  console.log(`Recent vote rows audited: ${recentVoteCount}`);
  console.log(`Party-break vote rows audited: ${partyBreakVoteCount}`);
  console.log(`Collaboration rows audited: ${collaborationRows}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
