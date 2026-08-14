import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOVTRACK_ROLE_API = "https://www.govtrack.us/api/v2/role";
const GOVTRACK_VOTE_API = "https://www.govtrack.us/api/v2/vote";
const GOVTRACK_BILL_API = "https://www.govtrack.us/api/v2/bill";
const TARGET_CONGRESS = 119;
const REQUEST_TIMEOUT_MS = 20000;
const VOTE_CSV_CONCURRENCY = 12;
const BILLS_CONCURRENCY = 12;
const RECENT_LIMIT = 10;

function getFetch() {
  if (typeof fetch === "function") return fetch;
  return (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function parsePersonIdFromLink(link) {
  const m = String(link || "").match(/\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

function toVoteClass(voteText) {
  const v = String(voteText || "").trim().toLowerCase();
  if (v === "yea" || v === "aye") return "yes";
  if (v === "nay" || v === "no") return "no";
  if (v === "present") return "abstain";
  if (v === "not voting" || v === "no vote") return "missed";
  return "other";
}

function toChoiceLabel(voteText) {
  const cls = toVoteClass(voteText);
  if (cls === "yes") return "Yes";
  if (cls === "no") return "No";
  if (cls === "abstain") return "Present";
  if (cls === "missed") return "Missed";
  return String(voteText || "").trim() || "기타";
}

function extractVoteId(voteLink) {
  return String(voteLink || "").trim().split("/").pop() || "";
}

function toISODate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

const CONGRESS_BILL_TYPE_PATHS = {
  house_bill: "house-bill",
  senate_bill: "senate-bill",
  house_resolution: "house-resolution",
  senate_resolution: "senate-resolution",
  house_concurrent_resolution: "house-concurrent-resolution",
  senate_concurrent_resolution: "senate-concurrent-resolution",
  house_joint_resolution: "house-joint-resolution",
  senate_joint_resolution: "senate-joint-resolution",
};

function buildCongressBillUrl(bill) {
  const congress = Number(bill?.congress);
  const number = Number(bill?.number);
  const typePath = CONGRESS_BILL_TYPE_PATHS[String(bill?.bill_type || "")];
  if (!Number.isFinite(congress) || !Number.isFinite(number) || !typePath) return "";
  return `https://www.congress.gov/bill/${congress}th-congress/${typePath}/${number}/text`;
}

function classifyVote(vote) {
  const category = String(vote?.category || "").trim().toLowerCase();
  const detail = `${vote?.vote_type || ""} ${vote?.question_details || ""} ${vote?.question || ""}`.toLowerCase();

  if (detail.includes("motion to recommit")) return { code: "recommit", label: "Motion to recommit", isFinal: false };
  if (category === "amendment" || detail.includes("on the amendment")) {
    return { code: "amendment", label: "Amendment", isFinal: false };
  }
  if (category.startsWith("passage") || detail.includes("on passage")) {
    return { code: "passage", label: "Final passage", isFinal: true };
  }
  if (category === "procedural" || detail.includes("ordering the previous question")) {
    return { code: "procedural", label: "Procedural vote", isFinal: false };
  }
  if (category.includes("conference")) return { code: "conference", label: "Conference report", isFinal: false };

  return {
    code: category || "other",
    label: String(vote?.category_label || vote?.vote_type || "Other vote").trim(),
    isFinal: false,
  };
}

async function fetchWithTimeout(fetchFn, input, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchPaged(fetchFn, baseUrl, params = {}, pageSize = 600, maxPages = 500) {
  const out = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(baseUrl);
    const query = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      limit: String(pageSize),
      offset: String(page * pageSize),
    });
    url.search = query.toString();

    const res = await fetchWithTimeout(fetchFn, url);
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
    }

    const json = await res.json();
    const rows = Array.isArray(json?.objects) ? json.objects : [];
    out.push(...rows);

    if (rows.length < pageSize) break;
  }
  return out;
}

function parseVoteCsv(csvText) {
  const lines = String(csvText || "").split(/\r?\n/).filter(Boolean);
  const start = lines.findIndex((line) => /^person,state,district,vote,name,party\s*$/i.test(line.trim()));
  if (start < 0) return [];

  const rows = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || /^\s*$/.test(line)) continue;

    const cols = [];
    let cur = "";
    let inQuote = false;

    for (let j = 0; j < line.length; j += 1) {
      const ch = line[j];
      if (ch === '"') {
        if (inQuote && line[j + 1] === '"') {
          cur += '"';
          j += 1;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === "," && !inQuote) {
        cols.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);

    if (cols.length < 6) continue;

    rows.push({
      personId: Number(cols[0]),
      vote: cols[3],
      party: cols[5],
    });
  }

  return rows;
}

function computePartyMajor(records) {
  const partyCounts = {
    Democrat: { yes: 0, no: 0 },
    Republican: { yes: 0, no: 0 },
  };

  for (const r of records) {
    const cls = toVoteClass(r.vote);
    if ((r.party === "Democrat" || r.party === "Republican") && (cls === "yes" || cls === "no")) {
      partyCounts[r.party][cls] += 1;
    }
  }

  const partyMajor = {};
  for (const party of ["Democrat", "Republican"]) {
    const { yes, no } = partyCounts[party];
    if (yes > no) partyMajor[party] = "yes";
    else if (no > yes) partyMajor[party] = "no";
    else partyMajor[party] = null;
  }
  return partyMajor;
}

async function buildPersonMaps(fetchFn) {
  const roleRows = await fetchPaged(fetchFn, GOVTRACK_ROLE_API, {
    current: true,
    role_type: "representative",
  });

  const personIdToBioguide = new Map();
  const bioguideToPersonId = new Map();

  for (const row of roleRows) {
    const bioguide = String(row?.person?.bioguideid || "").trim().toUpperCase();
    const personId = parsePersonIdFromLink(row?.person?.link);
    if (bioguide && Number.isFinite(personId)) {
      personIdToBioguide.set(personId, bioguide);
      bioguideToPersonId.set(bioguide, personId);
    }
  }

  return { personIdToBioguide, bioguideToPersonId };
}

async function fetchVoteCsvInfo(fetchFn, vote) {
  const voteLink = String(vote?.link || "").trim();
  if (!voteLink) return null;

  const csvUrl = `${voteLink}/export/csv`;
  let res;
  try {
    res = await fetchWithTimeout(fetchFn, csvUrl);
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const csvText = await res.text();
  const records = parseVoteCsv(csvText);
  if (!records.length) return null;

  const voteKind = classifyVote(vote);
  const relatedBill = vote?.related_bill || null;
  const session = String(vote?.session || "").trim();
  const voteNumber = Number(vote?.number);

  const voteMeta = {
    voteId: extractVoteId(vote.link),
    billNo: relatedBill?.display_number || `House Vote #${vote?.number ?? ""}`.trim(),
    title: relatedBill?.title_without_number || vote?.question || "House Vote",
    subject: String(vote?.question || relatedBill?.title_without_number || "House Vote").trim(),
    voteDate: toISODate(vote?.created),
    result: String(vote?.result || "").trim() || "",
    question: String(vote?.question || "").trim(),
    voteLabel: `House Vote #${vote?.number ?? ""}`.trim(),
    voteKind: voteKind.code,
    voteKindLabel: voteKind.label,
    isFinalPassage: voteKind.isFinal,
    billUrl: buildCongressBillUrl(relatedBill),
    voteUrl: session && Number.isFinite(voteNumber)
      ? `https://clerk.house.gov/Votes/${session}${voteNumber}`
      : String(vote?.link || "").trim(),
  };

  return {
    records,
    partyMajor: computePartyMajor(records),
    voteMeta,
  };
}

async function computeVoteStats(fetchFn, personIdToBioguide) {
  const voteRows = await fetchPaged(fetchFn, GOVTRACK_VOTE_API, {
    congress: TARGET_CONGRESS,
    chamber: "house",
  }, 600, 20);

  const statsByBioguide = new Map();
  const recentVotesByBioguide = new Map();
  const partyBreakVotesByBioguide = new Map();

  function ensureStats(bioguide) {
    if (!statsByBioguide.has(bioguide)) {
      statsByBioguide.set(bioguide, {
        voteRows: 0,
        missedRows: 0,
        comparableRows: 0,
        withPartyRows: 0,
      });
    }
    return statsByBioguide.get(bioguide);
  }

  function ensureRecentVotes(bioguide) {
    if (!recentVotesByBioguide.has(bioguide)) {
      recentVotesByBioguide.set(bioguide, []);
    }
    return recentVotesByBioguide.get(bioguide);
  }

  function ensurePartyBreakVotes(bioguide) {
    if (!partyBreakVotesByBioguide.has(bioguide)) {
      partyBreakVotesByBioguide.set(bioguide, []);
    }
    return partyBreakVotesByBioguide.get(bioguide);
  }

  let processedVotes = 0;
  let skippedVoteCsv = 0;

  for (let i = 0; i < voteRows.length; i += VOTE_CSV_CONCURRENCY) {
    const batch = voteRows.slice(i, i + VOTE_CSV_CONCURRENCY);
    const results = await Promise.all(batch.map((vote) => fetchVoteCsvInfo(fetchFn, vote)));

    for (const info of results) {
      if (!info) {
        skippedVoteCsv += 1;
        continue;
      }

      processedVotes += 1;
      const { records, partyMajor, voteMeta } = info;

      for (const r of records) {
        const bioguide = personIdToBioguide.get(r.personId);
        if (!bioguide) continue;

        const stat = ensureStats(bioguide);
        stat.voteRows += 1;

        const cls = toVoteClass(r.vote);
        if (cls === "missed") stat.missedRows += 1;

        let isPartyBreak = false;
        if ((r.party === "Democrat" || r.party === "Republican") && (cls === "yes" || cls === "no")) {
          const major = partyMajor[r.party];
          if (major) {
            stat.comparableRows += 1;
            if (cls === major) stat.withPartyRows += 1;
            else isPartyBreak = true;
          }
        }

        const memberVote = {
          voteId: voteMeta.voteId,
          billNo: voteMeta.billNo,
          title: voteMeta.title,
          voteDate: voteMeta.voteDate,
          choice: toChoiceLabel(r.vote),
          result: voteMeta.result,
          question: voteMeta.question,
          voteLabel: voteMeta.voteLabel,
          subject: voteMeta.subject,
          voteKind: voteMeta.voteKind,
          voteKindLabel: voteMeta.voteKindLabel,
          isFinalPassage: voteMeta.isFinalPassage,
          billUrl: voteMeta.billUrl,
          voteUrl: voteMeta.voteUrl,
        };

        ensureRecentVotes(bioguide).push(memberVote);
        if (isPartyBreak) ensurePartyBreakVotes(bioguide).push(memberVote);
      }
    }

    if (processedVotes > 0 && processedVotes % 50 <= VOTE_CSV_CONCURRENCY) {
      console.log(`Processed vote CSVs: ${processedVotes}/${voteRows.length}`);
    }
  }

  return {
    voteRows,
    statsByBioguide,
    recentVotesByBioguide,
    partyBreakVotesByBioguide,
    processedVotes,
    skippedVoteCsv,
  };
}

function mapBillStatus(status) {
  const s = String(status || "").toLowerCase();
  if (!s) return "";
  if (s.includes("enacted") || s.includes("passed")) return "Passed";
  if (s.includes("introduced")) return "Introduced";
  if (s.includes("referred") || s.includes("committee")) return "In Committee";
  return String(status || "");
}

async function fetchSponsoredData(fetchFn, personId) {
  const url = new URL(GOVTRACK_BILL_API);
  url.search = new URLSearchParams({
    congress: String(TARGET_CONGRESS),
    sponsor: String(personId),
    sort: "-introduced_date",
    limit: String(RECENT_LIMIT),
    offset: "0",
  }).toString();

  let res;
  try {
    res = await fetchWithTimeout(fetchFn, url);
  } catch {
    return { count: 0, recentBills: [] };
  }

  if (!res.ok) return { count: 0, recentBills: [] };

  const json = await res.json();
  const rows = Array.isArray(json?.objects) ? json.objects : [];
  const recentBills = rows.slice(0, RECENT_LIMIT).map((b) => ({
    billId: String(b?.link || ""),
    billNo: String(b?.display_number || ""),
    title: String(b?.title_without_number || b?.title || "").trim(),
    proposalDate: toISODate(b?.introduced_date),
    status: mapBillStatus(b?.current_status_label || b?.current_status || ""),
    billUrl: buildCongressBillUrl(b),
  }));

  return {
    count: Number(json?.meta?.total_count || 0),
    recentBills,
  };
}

async function computeBillsSponsored(fetchFn, bioguideToPersonId) {
  const entries = [...bioguideToPersonId.entries()];
  const billsByBioguide = new Map();
  const recentBillsByBioguide = new Map();
  let checked = 0;

  for (let i = 0; i < entries.length; i += BILLS_CONCURRENCY) {
    const batch = entries.slice(i, i + BILLS_CONCURRENCY);
    const results = await Promise.all(
      batch.map(([, personId]) => fetchSponsoredData(fetchFn, personId))
    );

    for (let j = 0; j < batch.length; j += 1) {
      const [bioguide] = batch[j];
      const data = results[j] || { count: 0, recentBills: [] };
      billsByBioguide.set(bioguide, data.count);
      recentBillsByBioguide.set(bioguide, data.recentBills);
      checked += 1;
    }

    if (checked % 60 <= BILLS_CONCURRENCY) {
      console.log(`Checked bill sponsor counts: ${checked}/${entries.length}`);
    }
  }

  return { billsByBioguide, recentBillsByBioguide, checkedMembers: checked };
}

function sortedUniqueVotes(votes) {
  const sorted = [...votes].sort((a, b) => String(b.voteDate || "").localeCompare(String(a.voteDate || "")));
  const seen = new Set();
  const out = [];

  for (const v of sorted) {
    const key = String(v.voteUrl || "") || `${String(v.voteDate || "")}|${String(v.voteId || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }

  return out;
}

function sortRecentVotes(votes, predicate = () => true) {
  return sortedUniqueVotes(votes).filter(predicate).slice(0, RECENT_LIMIT);
}

function sortAllVotes(votes) {
  const sorted = [...votes].sort((a, b) => {
      const dateDiff = String(b.voteDate || "").localeCompare(String(a.voteDate || ""));
      if (dateDiff) return dateDiff;
      return String(b.voteId || "").localeCompare(String(a.voteId || ""), undefined, { numeric: true });
    });
  const seen = new Set();
  return sorted.filter((vote) => {
    const key = String(vote.voteUrl || "") || `${vote.voteDate}|${vote.voteId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function latestDate(values) {
  return values.map((value) => toISODate(value)).filter(Boolean).sort().pop() || "";
}

function compactVoteKey(vote) {
  const officialMatch = String(vote?.voteUrl || "").match(/\/Votes\/(\d+)$/i);
  if (officialMatch) return officialMatch[1];
  return `${String(vote?.voteDate || "").replace(/-/g, "")}_${String(vote?.voteId || "")}`;
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..", "..");
  const membersPath = path.join(projectRoot, "data", "us", "house_members.json");
  const voteEvidencePath = path.join(projectRoot, "data", "us", "vote_evidence.json");

  const fetchFn = getFetch();
  const members = JSON.parse(await readFile(membersPath, "utf8"));

  const { personIdToBioguide, bioguideToPersonId } = await buildPersonMaps(fetchFn);
  const {
    voteRows,
    statsByBioguide,
    recentVotesByBioguide,
    partyBreakVotesByBioguide,
    processedVotes,
    skippedVoteCsv,
  } = await computeVoteStats(fetchFn, personIdToBioguide);

  const {
    billsByBioguide,
    recentBillsByBioguide,
    checkedMembers,
  } = await computeBillsSponsored(fetchFn, bioguideToPersonId);

  const houseVotesAsOf = latestDate(voteRows.map((vote) => vote?.created));
  const sponsoredBillsAsOf = latestDate(
    [...recentBillsByBioguide.values()].flat().map((bill) => bill?.proposalDate)
  );
  const partyBreakMembers = {};
  const partyBreakVoteIndex = {};

  function voteReference(vote) {
    const voteKey = compactVoteKey(vote);
    if (!partyBreakVoteIndex[voteKey]) {
      partyBreakVoteIndex[voteKey] = {
        voteId: vote.voteId,
        billNo: vote.billNo,
        title: vote.title,
        subject: vote.subject,
        voteDate: vote.voteDate,
        result: vote.result,
        voteLabel: vote.voteLabel,
        voteKind: vote.voteKind,
        voteKindLabel: vote.voteKindLabel,
        isFinalPassage: vote.isFinalPassage,
        billUrl: vote.billUrl,
        voteUrl: vote.voteUrl,
      };
    }
    return { voteKey, choice: vote.choice };
  }

  let withVoteStats = 0;

  for (const m of members) {
    const bioguide = String(m.bioguideId || "").trim().toUpperCase();
    const vote = statsByBioguide.get(bioguide);

    if (!vote || vote.voteRows === 0) {
      m.votesWithPartyPct = null;
      m.partyDifferentVotesCount = 0;
      m.partyComparableVotesCount = 0;
      m.missedVotesPct = null;
      m.missedVotesCount = 0;
    } else {
      m.missedVotesPct = round1((vote.missedRows / vote.voteRows) * 100);
      m.missedVotesCount = vote.missedRows;
      m.votesWithPartyPct = vote.comparableRows > 0
        ? round1((vote.withPartyRows / vote.comparableRows) * 100)
        : null;
      m.partyDifferentVotesCount = Math.max(0, vote.comparableRows - vote.withPartyRows);
      m.partyComparableVotesCount = vote.comparableRows;
      withVoteStats += 1;
    }

    m.billsSponsored = billsByBioguide.get(bioguide) || 0;
    const allMemberVotes = recentVotesByBioguide.get(bioguide) || [];
    const recentFinalVotes = sortRecentVotes(allMemberVotes, (voteRow) => voteRow.isFinalPassage === true);
    const recentPreliminaryVotes = sortRecentVotes(allMemberVotes, (voteRow) => voteRow.isFinalPassage !== true);
    delete m.recentVotes;
    delete m.recentFinalVotes;
    delete m.recentPreliminaryVotes;
    m.recentBills = (recentBillsByBioguide.get(bioguide) || []).slice(0, RECENT_LIMIT);
    m.dataAsOf = {
      ...(m.dataAsOf || {}),
      houseVotes: houseVotesAsOf,
      sponsoredBills: sponsoredBillsAsOf,
    };

    partyBreakMembers[bioguide] = {
      final: recentFinalVotes.map(voteReference),
      preliminary: recentPreliminaryVotes.map(voteReference),
      partyBreaks: sortAllVotes(partyBreakVotesByBioguide.get(bioguide) || []).map(voteReference),
    };
  }

  await writeFile(membersPath, `${JSON.stringify(members, null, 2)}\n`, "utf8");
  await writeFile(voteEvidencePath, `${JSON.stringify({
    congress: TARGET_CONGRESS,
    houseVotesAsOf,
    votes: partyBreakVoteIndex,
    members: partyBreakMembers,
  }, null, 2)}\n`, "utf8");

  console.log(`Vote rows fetched (119th House): ${voteRows.length}`);
  console.log(`Vote CSV processed: ${processedVotes}`);
  console.log(`Vote CSV skipped (timeout/invalid): ${skippedVoteCsv}`);
  console.log(`Members enriched with vote stats: ${withVoteStats}`);
  console.log(`Members checked for sponsored bill counts: ${checkedMembers}`);
  console.log(`Members total: ${members.length}`);
  console.log(`Wrote file: ${membersPath}`);
  console.log(`Wrote file: ${voteEvidencePath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
