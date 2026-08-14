import assert from "node:assert/strict";
import {
  deriveBillLifecycles,
  deriveParticipationContexts,
  derivePartyComparisons,
  normalizeBillStatus,
  normalizeVoteDate,
} from "./lib/deriveRepresentativeMetrics.js";

const members = [
  { monaCode: "a", name: "가", party: "가상당" },
  { monaCode: "b", name: "나", party: "가상당" },
  { monaCode: "c", name: "다", party: "가상당" },
  { monaCode: "d", name: "라", party: "무소속" },
];

const votes = [
  { monaCode: "a", billId: "1", title: "첫 법안", voteDate: "20260101 120000", choice: "찬성" },
  { monaCode: "b", billId: "1", title: "첫 법안", voteDate: "20260101 120000", choice: "찬성" },
  { monaCode: "c", billId: "1", title: "첫 법안", voteDate: "20260101 120000", choice: "반대" },
  { monaCode: "d", billId: "1", title: "첫 법안", voteDate: "20260101 120000", choice: "반대" },
  { monaCode: "a", billId: "2", title: "동률 법안", voteDate: "20260301 120000", choice: "찬성" },
  { monaCode: "b", billId: "2", title: "동률 법안", voteDate: "20260301 120000", choice: "반대" },
  { monaCode: "c", billId: "2", title: "동률 법안", voteDate: "20260301 120000", choice: "불참" },
  { monaCode: "a", billId: "3", title: "최근 법안", voteDate: "20260320 120000", choice: "반대" },
  { monaCode: "b", billId: "3", title: "최근 법안", voteDate: "20260320 120000", choice: "반대" },
  { monaCode: "c", billId: "3", title: "최근 법안", voteDate: "20260320 120000", choice: "찬성" },
  { monaCode: "former-1", party: "옛당", billId: "4", title: "정당 이력 법안", voteDate: "20260325 120000", choice: "찬성" },
  { monaCode: "former-2", party: "옛당", billId: "4", title: "정당 이력 법안", voteDate: "20260325 120000", choice: "찬성" },
  { monaCode: "c", party: "옛당", billId: "4", title: "정당 이력 법안", voteDate: "20260325 120000", choice: "반대" },
];

assert.equal(normalizeVoteDate("20260320 120000"), "2026-03-20");
assert.equal(normalizeVoteDate(""), "");

const result = derivePartyComparisons(members, votes);
assert.equal(result.get("a").differentFromPartyMajorityCount, 0);
assert.equal(result.get("c").differentFromPartyMajorityCount, 3);
assert.equal(result.get("c").last90DaysCount, 3);
assert.equal(result.get("c").eligibleVoteCount, 3);
assert.equal(result.get("c").basis, "party_at_vote_time");
assert.equal(result.get("c").votes[0].title, "정당 이력 법안");
assert.equal(result.get("c").votes[0].partyMajorityChoice, "찬성");
assert.deepEqual(result.get("c").votes[0].partyDistribution, {
  support: 2,
  oppose: 1,
  abstain: 0,
  absent: 0,
});
assert.equal(result.get("c").votes[1].partyMajorityChoice, "반대");
assert.deepEqual(result.get("c").votes[1].partyDistribution, {
  support: 1,
  oppose: 2,
  abstain: 0,
  absent: 0,
});
assert.equal(result.get("d").eligibleVoteCount, 0);
assert.equal(result.get("d").differentFromPartyMajorityCount, 0);

assert.deepEqual(normalizeBillStatus({ billStatus: "대안반영폐기" }), {
  rawStatus: "대안반영폐기",
  category: "incorporated",
  label: "대안반영폐기",
  completed: true,
});

const billResult = deriveBillLifecycles(
  members,
  [
    {
      monaCode: "a",
      billId: "old-passed",
      billTitle: "오래된 통과 법안",
      proposalDate: "2025-01-01",
      billStatus: "원안가결",
      source: { PUBL_MONA_CD: "b,d", COMMITTEE: "가상위원회" },
    },
    {
      monaCode: "a",
      billId: "recent-pending",
      billTitle: "최근 계류 법안",
      proposalDate: "2026-03-01",
      billStatus: "",
      source: { PUBL_MONA_CD: "b,c" },
    },
  ],
  { asOfDate: "2026-04-01", matureAfterDays: 180 }
);
const memberBills = billResult.get("a");
assert.equal(memberBills.leadSponsoredTotal, 2);
assert.equal(memberBills.completed, 1);
assert.equal(memberBills.inProgress, 1);
assert.equal(memberBills.crossPartyCount, 1);
assert.deepEqual(memberBills.olderThan180Days, {
  total: 1,
  completed: 1,
  completionRate: 100,
});

const participationResult = deriveParticipationContexts(members, [
  { monaCode: "a", billId: "v1", title: "참여 전", voteDate: "20260320 100000", choice: "찬성" },
  { monaCode: "a", billId: "v2", title: "불참 1", voteDate: "20260320 100100", choice: "불참" },
  { monaCode: "a", billId: "v3", title: "불참 2", voteDate: "20260320 100200", choice: "불참" },
  { monaCode: "a", billId: "v4", title: "참여 후", voteDate: "20260320 100300", choice: "반대" },
  { monaCode: "b", billId: "v1", voteDate: "20260320 100000", choice: "찬성" },
  { monaCode: "b", billId: "v2", voteDate: "20260320 100100", choice: "찬성" },
  { monaCode: "b", billId: "v3", voteDate: "20260320 100200", choice: "찬성" },
  { monaCode: "b", billId: "v4", voteDate: "20260320 100300", choice: "찬성" },
]);
assert.deepEqual(participationResult.get("a").term, {
  total: 4,
  participated: 2,
  absent: 2,
  rate: 50,
});
assert.equal(participationResult.get("a").absenceRuns.length, 1);
assert.equal(participationResult.get("a").absenceRuns[0].count, 2);
assert.equal(participationResult.get("a").absenceRuns[0].surroundedByParticipation, true);
assert.equal(participationResult.get("a").partyMedian.term, 75);

console.log("Derived metric tests passed.");
