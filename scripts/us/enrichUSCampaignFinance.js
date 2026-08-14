import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const REQUEST_TIMEOUT_MS = 30000;

function currentElectionCycle() {
  const year = new Date().getUTCFullYear();
  return year % 2 === 0 ? year : year + 1;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function districtNumber(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw || raw === "AL") return "00";
  return raw.padStart(2, "0");
}

async function fetchBuffer(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) throw new Error(`FEC download failed: ${response.status} ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractFirstZipFile(zipBuffer) {
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65_557); i -= 1) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid FEC ZIP: end-of-central-directory record not found");

  const centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (zipBuffer.readUInt32LE(centralOffset) !== 0x02014b50) {
    throw new Error("Invalid FEC ZIP: central directory not found");
  }

  const compressionMethod = zipBuffer.readUInt16LE(centralOffset + 10);
  const compressedSize = zipBuffer.readUInt32LE(centralOffset + 20);
  const localOffset = zipBuffer.readUInt32LE(centralOffset + 42);
  if (zipBuffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error("Invalid FEC ZIP: local file header not found");
  }

  const nameLength = zipBuffer.readUInt16LE(localOffset + 26);
  const extraLength = zipBuffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const compressed = zipBuffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) return compressed.toString("utf8");
  if (compressionMethod === 8) return inflateRawSync(compressed).toString("utf8");
  throw new Error(`Unsupported FEC ZIP compression method: ${compressionMethod}`);
}

function parseCandidateSummary(text, cycle) {
  const records = new Map();

  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line) continue;
    const columns = line.split("|");
    if (columns.length < 30) continue;

    const candidateId = String(columns[0] || "").trim().toUpperCase();
    if (!candidateId) continue;

    records.set(candidateId, {
      candidateId,
      cycle,
      name: String(columns[1] || "").trim(),
      totalReceipts: toNumber(columns[5]),
      totalDisbursements: toNumber(columns[7]),
      cashOnHand: toNumber(columns[10]),
      candidateContributions: toNumber(columns[11]),
      candidateLoans: toNumber(columns[12]),
      individualContributions: toNumber(columns[17]),
      state: String(columns[18] || "").trim().toUpperCase(),
      district: String(columns[19] || "").trim().padStart(2, "0"),
      pacContributions: toNumber(columns[25]),
      partyContributions: toNumber(columns[26]),
      coverageEndDate: String(columns[27] || "").trim(),
    });
  }

  return records;
}

function parseCommitteeMaster(text) {
  const committees = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line) continue;
    const columns = line.split("|");
    if (columns.length < 10) continue;
    const committeeId = String(columns[0] || "").trim().toUpperCase();
    if (!committeeId) continue;
    committees.set(committeeId, {
      committeeId,
      name: String(columns[1] || "").trim() || committeeId,
      designation: String(columns[8] || "").trim().toUpperCase(),
      committeeType: String(columns[9] || "").trim().toUpperCase(),
    });
  }
  return committees;
}

function parseCommitteeContributions(text, candidateIds, committees, cycle) {
  const directContributionTypes = new Set(["24K", "24Z"]);
  const transactions = new Map();

  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line) continue;
    const columns = line.split("|");
    if (columns.length < 22) continue;

    const transactionType = String(columns[5] || "").trim().toUpperCase();
    if (!directContributionTypes.has(transactionType)) continue;
    const memoText = String(columns[20] || "").trim();
    if (/earmark/i.test(memoText)) continue;

    const candidateId = String(columns[16] || "").trim().toUpperCase();
    if (!candidateIds.has(candidateId)) continue;

    const committeeId = String(columns[0] || "").trim().toUpperCase();
    const reportType = String(columns[2] || "").trim().toUpperCase();
    const transactionId = String(columns[17] || "").trim();
    const subId = String(columns[21] || "").trim();
    if (!committeeId || (!transactionId && !subId)) continue;

    const transactionKey = transactionId
      ? `${committeeId}|${reportType}|${transactionId}`
      : `${committeeId}|sub:${subId}`;
    const row = {
      candidateId,
      committeeId,
      amount: toNumber(columns[14]),
      fileNumber: toNumber(columns[18]),
      subId,
    };
    const current = transactions.get(transactionKey);
    if (
      !current ||
      row.fileNumber > current.fileNumber ||
      (row.fileNumber === current.fileNumber && row.subId > current.subId)
    ) {
      transactions.set(transactionKey, row);
    }
  }

  const totalsByCandidate = new Map();
  for (const row of transactions.values()) {
    if (!totalsByCandidate.has(row.candidateId)) totalsByCandidate.set(row.candidateId, new Map());
    const donorTotals = totalsByCandidate.get(row.candidateId);
    donorTotals.set(row.committeeId, (donorTotals.get(row.committeeId) || 0) + row.amount);
  }

  const topByCandidate = new Map();
  for (const [candidateId, donorTotals] of totalsByCandidate.entries()) {
    const top = [...donorTotals.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([committeeId, amount]) => {
        const committee = committees.get(committeeId) || {};
        return {
          committeeId,
          name: committee.name || committeeId,
          amount,
          committeeType: committee.committeeType || "",
          designation: committee.designation || "",
          sourceUrl: `https://www.fec.gov/data/committee/${committeeId}/?cycle=${cycle}`,
        };
      })
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
      .slice(0, 5);
    topByCandidate.set(candidateId, top);
  }

  return topByCandidate;
}

function normalizedNameTokens(value) {
  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "md"]);
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !suffixes.has(token) && token.length > 1);
}

function chooseCandidateByDistrictAndName(member, records) {
  const expectedState = String(member?.state || "").trim().toUpperCase();
  const expectedDistrict = districtNumber(member?.district);
  const memberTokens = normalizedNameTokens(member?.name);
  const firstName = memberTokens[0];
  const lastName = memberTokens[memberTokens.length - 1];
  if (!firstName || !lastName) return null;

  const matches = [...records.values()].filter((row) => {
    if (row.state !== expectedState || row.district !== expectedDistrict) return false;
    const candidateTokens = new Set(normalizedNameTokens(row.name));
    return candidateTokens.has(firstName) && candidateTokens.has(lastName);
  });

  return matches.sort(
    (a, b) => String(b.coverageEndDate).localeCompare(String(a.coverageEndDate)) || b.totalReceipts - a.totalReceipts
  )[0] || null;
}

function chooseCandidateRecord(member, records) {
  const expectedState = String(member?.state || "").trim().toUpperCase();
  const expectedDistrict = districtNumber(member?.district);
  const candidates = (member?.fecCandidateIds || [])
    .map((id) => records.get(String(id || "").trim().toUpperCase()))
    .filter(Boolean);

  const districtMatches = candidates.filter(
    (row) => row.state === expectedState && row.district === expectedDistrict
  );
  const eligible = districtMatches.length ? districtMatches : candidates;

  return eligible.sort(
    (a, b) => String(b.coverageEndDate).localeCompare(String(a.coverageEndDate)) || b.totalReceipts - a.totalReceipts
  )[0] || null;
}

function toISODate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : String(value || "").slice(0, 10);
}

async function main() {
  const cycle = Number(process.env.FEC_CYCLE) || currentElectionCycle();
  const previousCycle = cycle - 2;
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(__filename), "..", "..");
  const membersPath = path.join(projectRoot, "data", "us", "house_members.json");
  const candidateSummaryUrl = (year) =>
    `https://www.fec.gov/files/bulk-downloads/${year}/weball${String(year).slice(-2)}.zip`;
  const committeeContributionsUrl =
    `https://www.fec.gov/files/bulk-downloads/${cycle}/pas2${String(cycle).slice(-2)}.zip`;
  const committeeMasterUrl =
    `https://www.fec.gov/files/bulk-downloads/${cycle}/cm${String(cycle).slice(-2)}.zip`;

  const members = JSON.parse(await readFile(membersPath, "utf8"));
  const [currentZip, previousZip, contributionsZip, committeeMasterZip] = await Promise.all([
    fetchBuffer(candidateSummaryUrl(cycle)),
    fetchBuffer(candidateSummaryUrl(previousCycle)),
    fetchBuffer(committeeContributionsUrl),
    fetchBuffer(committeeMasterUrl),
  ]);
  const currentRecords = parseCandidateSummary(extractFirstZipFile(currentZip), cycle);
  const previousRecords = parseCandidateSummary(extractFirstZipFile(previousZip), previousCycle);
  const committees = parseCommitteeMaster(extractFirstZipFile(committeeMasterZip));
  const topContributorsByCandidate = parseCommitteeContributions(
    extractFirstZipFile(contributionsZip),
    new Set(currentRecords.keys()),
    committees,
    cycle
  );
  let matched = 0;
  let previousCycleFallbacks = 0;
  let verifiedNameFallbacks = 0;
  let missingFecIds = 0;

  for (const member of members) {
    if (!Array.isArray(member.fecCandidateIds) || !member.fecCandidateIds.length) missingFecIds += 1;
    let row = chooseCandidateRecord(member, currentRecords);
    if (!row) {
      row = chooseCandidateByDistrictAndName(member, currentRecords);
      if (row) verifiedNameFallbacks += 1;
    }
    if (!row) {
      row = chooseCandidateRecord(member, previousRecords);
      if (row) previousCycleFallbacks += 1;
    }
    if (!row) {
      row = chooseCandidateByDistrictAndName(member, previousRecords);
      if (row) {
        previousCycleFallbacks += 1;
        verifiedNameFallbacks += 1;
      }
    }

    if (!row) {
      member.campaignFinance = null;
      continue;
    }

    matched += 1;
    if (!member.fecCandidateIds.includes(row.candidateId)) {
      member.fecCandidateIds = [row.candidateId, ...member.fecCandidateIds];
    }
    member.campaignFinance = {
      cycle: row.cycle,
      candidateId: row.candidateId,
      totalReceipts: row.totalReceipts,
      individualContributions: row.individualContributions,
      pacContributions: row.pacContributions,
      partyContributions: row.partyContributions,
      candidateFunding: row.candidateContributions + row.candidateLoans,
      totalDisbursements: row.totalDisbursements,
      cashOnHand: row.cashOnHand,
      coverageEndDate: toISODate(row.coverageEndDate),
      sourceUrl: `https://www.fec.gov/data/candidate/${row.candidateId}/?cycle=${row.cycle}&election_full=true`,
      source: "Federal Election Commission",
      topCommitteeContributors: row.cycle === cycle
        ? (topContributorsByCandidate.get(row.candidateId) || [])
        : [],
    };
    member.dataAsOf = {
      ...(member.dataAsOf || {}),
      campaignFinance: toISODate(row.coverageEndDate),
    };
  }

  if (matched < Math.floor(members.length * 0.7)) {
    throw new Error(`FEC match coverage too low: ${matched}/${members.length} (missing IDs: ${missingFecIds})`);
  }

  await writeFile(membersPath, `${JSON.stringify(members, null, 2)}\n`, "utf8");
  console.log(`FEC cycle: ${cycle}`);
  console.log(`FEC summary records: ${currentRecords.size} current + ${previousRecords.size} previous`);
  console.log(`FEC committee records: ${committees.size}`);
  console.log(`Candidates with direct committee contributors: ${topContributorsByCandidate.size}`);
  console.log(`Members matched: ${matched}/${members.length}`);
  console.log(`Previous-cycle fallbacks: ${previousCycleFallbacks}`);
  console.log(`State/district/name verified fallbacks: ${verifiedNameFallbacks}`);
  console.log(`Members without FEC IDs: ${missingFecIds}`);
  console.log(`Wrote file: ${membersPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
