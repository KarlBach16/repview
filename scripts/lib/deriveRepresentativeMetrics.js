const YES = "찬성";
const NO = "반대";
const ABSTAIN = "기권";
const ABSENT = "불참";
const PARTY_COMPARISON_CHOICES = new Set([YES, NO]);

export function normalizeVoteDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function toUtcDate(value) {
  const normalized = normalizeVoteDate(value);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinDays(value, asOfDate, days) {
  const date = toUtcDate(value);
  const asOf = toUtcDate(asOfDate);
  if (!date || !asOf) return false;
  const diff = asOf.getTime() - date.getTime();
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function emptyDistribution() {
  return { support: 0, oppose: 0, abstain: 0, absent: 0, other: 0 };
}

function addChoice(distribution, choice) {
  if (choice === YES) distribution.support += 1;
  else if (choice === NO) distribution.oppose += 1;
  else if (choice === ABSTAIN) distribution.abstain += 1;
  else if (choice === ABSENT) distribution.absent += 1;
  else distribution.other += 1;
}

function choiceCount(distribution) {
  return distribution.support + distribution.oppose;
}

function partyMajority(distribution, minimumComparableVotes, minimumMajorityShare) {
  const comparableVotes = choiceCount(distribution);
  if (comparableVotes < minimumComparableVotes) return null;
  if (distribution.support === distribution.oppose) return null;

  const majorityChoice = distribution.support > distribution.oppose ? YES : NO;
  const majorityCount = Math.max(distribution.support, distribution.oppose);
  const majorityShare = majorityCount / comparableVotes;
  if (majorityShare < minimumMajorityShare) return null;

  return { majorityChoice, majorityCount, majorityShare, comparableVotes };
}

function compactDistribution(distribution) {
  return {
    support: distribution.support,
    oppose: distribution.oppose,
    abstain: distribution.abstain,
    absent: distribution.absent,
  };
}

function latestVoteDate(votes) {
  return votes.reduce((latest, vote) => {
    const date = normalizeVoteDate(vote?.voteDate);
    return date > latest ? date : latest;
  }, "");
}

/**
 * Derives factual comparisons between a member's yes/no choice and the most
 * common yes/no choice among members recorded in the same party for that vote.
 * The official roll-call party value is preferred; current roster party is
 * used only as a fallback for legacy rows.
 */
export function derivePartyComparisons(members, votes, options = {}) {
  const minimumComparableVotes = Number(options.minimumComparableVotes || 2);
  const minimumMajorityShare = Number(options.minimumMajorityShare || 0.6);
  const excludedParties = new Set(options.excludedParties || ["무소속"]);
  const memberByCode = new Map(
    members
      .map((member) => [String(member?.monaCode || "").trim(), member])
      .filter(([code]) => Boolean(code))
  );
  const votesByBill = new Map();

  for (const vote of votes) {
    const code = String(vote?.monaCode || "").trim();
    const billId = String(vote?.billId || "").trim();
    if (!code || !billId) continue;
    const rows = votesByBill.get(billId) || [];
    rows.push(vote);
    votesByBill.set(billId, rows);
  }

  const dataThrough = latestVoteDate(votes);
  const result = new Map();
  for (const member of members) {
    const code = String(member?.monaCode || "").trim();
    result.set(code, {
      basis: "party_at_vote_time",
      basisLabel: "표결 기록 당시 소속 정당 기준",
      dataThrough,
      eligibleVoteCount: 0,
      differentFromPartyMajorityCount: 0,
      last90DaysCount: 0,
      votes: [],
    });
  }

  for (const rows of votesByBill.values()) {
    const allDistribution = emptyDistribution();
    const partyDistributions = new Map();

    for (const vote of rows) {
      const member = memberByCode.get(String(vote?.monaCode || "").trim());
      const party = String(vote?.party || member?.party || "").trim();
      addChoice(allDistribution, String(vote?.choice || "").trim());
      if (!party || excludedParties.has(party)) continue;

      const distribution = partyDistributions.get(party) || emptyDistribution();
      addChoice(distribution, String(vote?.choice || "").trim());
      partyDistributions.set(party, distribution);
    }

    const majorityByParty = new Map();
    for (const [party, distribution] of partyDistributions) {
      const majority = partyMajority(
        distribution,
        minimumComparableVotes,
        minimumMajorityShare
      );
      if (majority) majorityByParty.set(party, { ...majority, distribution });
    }

    for (const vote of rows) {
      const code = String(vote?.monaCode || "").trim();
      const member = memberByCode.get(code);
      const party = String(vote?.party || member?.party || "").trim();
      const choice = String(vote?.choice || "").trim();
      const majority = majorityByParty.get(party);
      const memberResult = result.get(code);

      if (!memberResult || !majority || !PARTY_COMPARISON_CHOICES.has(choice)) continue;
      memberResult.eligibleVoteCount += 1;
      if (choice === majority.majorityChoice) continue;

      const item = {
        billId: String(vote?.billId || ""),
        billNo: String(vote?.billNo || ""),
        title: String(vote?.title || ""),
        voteDate: String(vote?.voteDate || ""),
        choice,
        partyMajorityChoice: majority.majorityChoice,
        partyMajorityShare: Number((majority.majorityShare * 100).toFixed(1)),
        partyDistribution: compactDistribution(majority.distribution),
        assemblyDistribution: compactDistribution(allDistribution),
      };

      memberResult.votes.push(item);
      memberResult.differentFromPartyMajorityCount += 1;
      if (isWithinDays(vote?.voteDate, dataThrough, 90)) {
        memberResult.last90DaysCount += 1;
      }
    }
  }

  for (const memberResult of result.values()) {
    memberResult.votes.sort((a, b) =>
      String(b.voteDate || "").localeCompare(String(a.voteDate || ""))
    );
  }

  return result;
}

const BILL_STATUS_MAP = new Map([
  ["원안가결", { category: "passed", label: "원안가결", completed: true }],
  ["수정가결", { category: "passed", label: "수정가결", completed: true }],
  ["대안반영폐기", { category: "incorporated", label: "대안반영폐기", completed: true }],
  ["수정안반영폐기", { category: "incorporated", label: "수정안반영폐기", completed: true }],
  ["부결", { category: "rejected", label: "부결", completed: true }],
  ["철회", { category: "withdrawn", label: "철회", completed: true }],
  ["폐기", { category: "discarded", label: "폐기", completed: true }],
  ["심사미료", { category: "discarded", label: "심사미료", completed: true }],
  ["회송", { category: "returned", label: "회송", completed: false }],
]);

export function normalizeBillStatus(bill) {
  const source = bill?.source || {};
  const rawStatus = String(
    bill?.billStatus ||
      source.PROC_RESULT ||
      source.LAW_PROC_RESULT_CD ||
      source.CMT_PROC_RESULT_CD ||
      ""
  ).trim();
  const mapped = BILL_STATUS_MAP.get(rawStatus);
  if (mapped) return { rawStatus, ...mapped };
  if (rawStatus) {
    return { rawStatus, category: "unknown", label: rawStatus, completed: false };
  }
  return { rawStatus: "", category: "in_progress", label: "심사 중", completed: false };
}

function normalizeIsoDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function daysBetween(startValue, endValue) {
  const start = toUtcDate(startValue);
  const end = toUtcDate(endValue);
  if (!start || !end) return null;
  return Math.max(Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)), 0);
}

function round1(value) {
  return Number(value.toFixed(1));
}

export function deriveBillLifecycles(members, bills, options = {}) {
  const asOfDate = normalizeIsoDate(options.asOfDate || new Date().toISOString());
  const matureAfterDays = Number(options.matureAfterDays || 180);
  const memberByCode = new Map(
    members
      .map((member) => [String(member?.monaCode || "").trim(), member])
      .filter(([code]) => Boolean(code))
  );
  const billsByLead = new Map();

  for (const bill of bills) {
    const leadCode = String(bill?.monaCode || "").trim();
    if (!leadCode || !memberByCode.has(leadCode)) continue;
    const rows = billsByLead.get(leadCode) || [];
    rows.push(bill);
    billsByLead.set(leadCode, rows);
  }

  const result = new Map();
  for (const member of members) {
    const code = String(member?.monaCode || "").trim();
    const party = String(member?.party || "").trim();
    const memberBills = billsByLead.get(code) || [];
    const statusCounts = {};
    let completed = 0;
    let inProgress = 0;
    let returned = 0;
    let unknown = 0;
    let crossPartyCount = 0;
    let matureTotal = 0;
    let matureCompleted = 0;

    const normalizedBills = memberBills.map((bill) => {
      const status = normalizeBillStatus(bill);
      const ageDays = daysBetween(bill?.proposalDate, asOfDate);
      const coSponsorCodes = String(bill?.source?.PUBL_MONA_CD || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const coSponsorParties = {};

      for (const coSponsorCode of coSponsorCodes) {
        const coSponsorParty = String(memberByCode.get(coSponsorCode)?.party || "").trim();
        if (!coSponsorParty) continue;
        coSponsorParties[coSponsorParty] = (coSponsorParties[coSponsorParty] || 0) + 1;
      }

      const hasOtherParty = Object.keys(coSponsorParties).some(
        (coSponsorParty) => coSponsorParty !== party
      );
      if (hasOtherParty) crossPartyCount += 1;

      statusCounts[status.label] = (statusCounts[status.label] || 0) + 1;
      if (status.completed) completed += 1;
      else if (status.category === "in_progress") inProgress += 1;
      else if (status.category === "returned") returned += 1;
      else unknown += 1;

      if (ageDays !== null && ageDays >= matureAfterDays) {
        matureTotal += 1;
        if (status.completed) matureCompleted += 1;
      }

      return {
        billId: String(bill?.billId || ""),
        title: String(bill?.billTitle || ""),
        proposalDate: String(bill?.proposalDate || ""),
        ageDays,
        status: status.label,
        statusCategory: status.category,
        completed: status.completed,
        committee: String(bill?.source?.COMMITTEE || ""),
        coSponsorCount: coSponsorCodes.length,
        coSponsorParties,
        hasOtherParty,
        detailLink: String(bill?.detailLink || ""),
      };
    });

    normalizedBills.sort((a, b) =>
      String(b.proposalDate || "").localeCompare(String(a.proposalDate || ""))
    );

    result.set(code, {
      asOfDate,
      matureAfterDays,
      leadSponsoredTotal: normalizedBills.length,
      inProgress,
      completed,
      returned,
      unknown,
      crossPartyCount,
      partyBasis: "current_party",
      statusCounts,
      olderThan180Days: {
        total: matureTotal,
        completed: matureCompleted,
        completionRate: matureTotal > 0 ? round1((matureCompleted / matureTotal) * 100) : null,
      },
      recentBills: normalizedBills.slice(0, 10),
    });
  }

  return result;
}

export function deriveCollaborationNetworks(members, bills, options = {}) {
  const topLimit = Number(options.topLimit || 5);
  const sharedBillLimit = Number(options.sharedBillLimit || 4);
  const memberByCode = new Map(
    members
      .map((member) => [String(member?.monaCode || "").trim(), member])
      .filter(([code]) => Boolean(code))
  );
  const relationsByMember = new Map(
    [...memberByCode.keys()].map((code) => [code, new Map()])
  );
  const collaborationBillIds = new Map(
    [...memberByCode.keys()].map((code) => [code, new Set()])
  );
  const crossPartyBillIds = new Map(
    [...memberByCode.keys()].map((code) => [code, new Set()])
  );
  const seenBillIds = new Set();

  function addRelation(memberCode, collaboratorCode, bill) {
    const relations = relationsByMember.get(memberCode);
    if (!relations) return;
    const relation = relations.get(collaboratorCode) || {
      billIds: new Set(),
      bills: [],
    };
    if (relation.billIds.has(bill.billId)) return;
    relation.billIds.add(bill.billId);
    relation.bills.push({
      billId: bill.billId,
      title: String(bill?.billTitle || ""),
      proposalDate: String(bill?.proposalDate || ""),
      detailLink: String(bill?.detailLink || ""),
      leadMonaCode: String(bill?.monaCode || "").trim(),
    });
    relations.set(collaboratorCode, relation);
  }

  for (const bill of bills) {
    const billId = String(bill?.billId || "").trim();
    if (!billId || seenBillIds.has(billId)) continue;
    seenBillIds.add(billId);

    const participantCodes = [
      String(bill?.monaCode || "").trim(),
      ...String(bill?.source?.PUBL_MONA_CD || "")
        .split(",")
        .map((value) => value.trim()),
    ].filter((code, index, rows) => memberByCode.has(code) && rows.indexOf(code) === index);

    if (participantCodes.length < 2) continue;

    for (const memberCode of participantCodes) {
      collaborationBillIds.get(memberCode)?.add(billId);
      const memberParty = String(memberByCode.get(memberCode)?.party || "").trim();
      if (participantCodes.some((code) =>
        String(memberByCode.get(code)?.party || "").trim() !== memberParty
      )) {
        crossPartyBillIds.get(memberCode)?.add(billId);
      }
    }

    for (let left = 0; left < participantCodes.length; left += 1) {
      for (let right = left + 1; right < participantCodes.length; right += 1) {
        addRelation(participantCodes[left], participantCodes[right], bill);
        addRelation(participantCodes[right], participantCodes[left], bill);
      }
    }
  }

  const result = new Map();
  for (const [memberCode, relations] of relationsByMember) {
    const memberParty = String(memberByCode.get(memberCode)?.party || "").trim();
    const collaborators = [...relations.entries()]
      .map(([collaboratorCode, relation]) => {
        const collaborator = memberByCode.get(collaboratorCode) || {};
        const sharedBills = [...relation.bills]
          .sort((a, b) => String(b.proposalDate).localeCompare(String(a.proposalDate)))
          .slice(0, sharedBillLimit);
        return {
          monaCode: collaboratorCode,
          slug: String(collaborator?.id || ""),
          name: String(collaborator?.name || ""),
          party: String(collaborator?.party || ""),
          district: String(collaborator?.district || ""),
          photo: String(collaborator?.photo || ""),
          billCount: relation.billIds.size,
          sameParty: String(collaborator?.party || "").trim() === memberParty,
          sharedBills,
        };
      })
      .sort((a, b) => b.billCount - a.billCount || a.name.localeCompare(b.name, "ko"));

    result.set(memberCode, {
      basis: "same_proposal_roster",
      collaborationBillCount: collaborationBillIds.get(memberCode)?.size || 0,
      uniqueCollaboratorCount: collaborators.length,
      otherPartyCollaboratorCount: collaborators.filter((item) => !item.sameParty).length,
      crossPartyBillCount: crossPartyBillIds.get(memberCode)?.size || 0,
      topCollaborators: collaborators.slice(0, topLimit),
    });
  }

  return result;
}

function participationSummary(rows) {
  const total = rows.length;
  const absent = rows.filter((row) => String(row?.choice || "").trim() === ABSENT).length;
  const participated = Math.max(total - absent, 0);
  return {
    total,
    participated,
    absent,
    rate: total > 0 ? round1((participated / total) * 100) : null,
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return round1(sorted[middle]);
  return round1((sorted[middle - 1] + sorted[middle]) / 2);
}

function buildAbsenceRuns(rows) {
  const byDate = new Map();
  for (const row of rows) {
    const date = normalizeVoteDate(row?.voteDate);
    if (!date) continue;
    const dateRows = byDate.get(date) || [];
    dateRows.push(row);
    byDate.set(date, dateRows);
  }

  const runs = [];
  for (const [date, dateRows] of byDate) {
    dateRows.sort((a, b) => String(a?.voteDate || "").localeCompare(String(b?.voteDate || "")));
    let start = -1;

    function closeRun(endExclusive) {
      if (start < 0) return;
      const runRows = dateRows.slice(start, endExclusive);
      const previous = start > 0 ? dateRows[start - 1] : null;
      const next = endExclusive < dateRows.length ? dateRows[endExclusive] : null;
      runs.push({
        date,
        count: runRows.length,
        surroundedByParticipation:
          Boolean(previous) &&
          Boolean(next) &&
          String(previous?.choice || "").trim() !== ABSENT &&
          String(next?.choice || "").trim() !== ABSENT,
      });
      start = -1;
    }

    for (let index = 0; index < dateRows.length; index += 1) {
      const isAbsent = String(dateRows[index]?.choice || "").trim() === ABSENT;
      if (isAbsent && start < 0) start = index;
      if (!isAbsent && start >= 0) closeRun(index);
    }
    closeRun(dateRows.length);
  }

  return runs.sort((a, b) => {
    const dateOrder = String(b.date).localeCompare(String(a.date));
    return dateOrder || b.count - a.count;
  });
}

export function deriveParticipationContexts(members, votes) {
  const memberByCode = new Map(
    members
      .map((member) => [String(member?.monaCode || "").trim(), member])
      .filter(([code]) => Boolean(code))
  );
  const rowsByMember = new Map();
  const dataThrough = latestVoteDate(votes);

  for (const vote of votes) {
    const code = String(vote?.monaCode || "").trim();
    if (!memberByCode.has(code)) continue;
    const rows = rowsByMember.get(code) || [];
    rows.push(vote);
    rowsByMember.set(code, rows);
  }

  const result = new Map();
  for (const member of members) {
    const code = String(member?.monaCode || "").trim();
    const rows = rowsByMember.get(code) || [];
    result.set(code, {
      dataThrough,
      term: participationSummary(rows),
      last90Days: participationSummary(
        rows.filter((row) => isWithinDays(row?.voteDate, dataThrough, 90))
      ),
      last30Days: participationSummary(
        rows.filter((row) => isWithinDays(row?.voteDate, dataThrough, 30))
      ),
      allMemberMedian: {},
      partyMedian: {},
      absenceRuns: buildAbsenceRuns(rows).slice(0, 8),
    });
  }

  const periods = ["term", "last90Days", "last30Days"];
  for (const period of periods) {
    const allRates = [...result.values()].map((item) => item[period].rate);
    const allMedian = median(allRates);
    const partyRates = new Map();

    for (const member of members) {
      const code = String(member?.monaCode || "").trim();
      const party = String(member?.party || "").trim();
      const rate = result.get(code)?.[period]?.rate;
      if (!party || !Number.isFinite(rate)) continue;
      const rates = partyRates.get(party) || [];
      rates.push(rate);
      partyRates.set(party, rates);
    }

    for (const member of members) {
      const code = String(member?.monaCode || "").trim();
      const party = String(member?.party || "").trim();
      const item = result.get(code);
      item.allMemberMedian[period] = allMedian;
      item.partyMedian[period] = median(partyRates.get(party) || []);
    }
  }

  return result;
}
