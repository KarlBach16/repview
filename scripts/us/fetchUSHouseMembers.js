import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml";

// Non-voting House seats (delegates + resident commissioner)
const NON_VOTING_HOUSE_CODES = new Set(["AS", "DC", "GU", "MP", "PR", "VI"]);

function getFetch() {
  if (typeof fetch === "function") return fetch;
  return (...args) => import("node-fetch").then(({ default: f }) => f(...args));
}

function cleanYamlValue(value) {
  return String(value || "").trim().replace(/^['\"]|['\"]$/g, "");
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function districtLabel(rawDistrict) {
  const d = String(rawDistrict || "").trim();
  if (!d || d === "0") return "AL";
  return d;
}

function districtSortValue(rawDistrict) {
  const d = districtLabel(rawDistrict);
  if (d === "AL") return -1;
  const n = Number(d);
  return Number.isFinite(n) ? n : 999;
}

function parseYamlLegislators(yamlText) {
  const lines = String(yamlText || "").split(/\r?\n/);
  const records = [];

  let rec = null;
  let section = "";
  let inTerms = false;
  let currentTerm = null;

  function pushCurrent() {
    if (!rec) return;
    records.push(rec);
  }

  for (const line of lines) {
    if (line.startsWith("- id:")) {
      pushCurrent();
      rec = {
        bioguideId: "",
        nameOfficial: "",
        nameFirst: "",
        nameLast: "",
        terms: [],
      };
      section = "";
      inTerms = false;
      currentTerm = null;
      continue;
    }

    if (!rec) continue;

    if (line.startsWith("  name:")) {
      section = "name";
      inTerms = false;
      currentTerm = null;
      continue;
    }

    if (line.startsWith("  terms:")) {
      section = "terms";
      inTerms = true;
      currentTerm = null;
      continue;
    }

    if (/^  [a-z_]+:/.test(line) && !line.startsWith("  terms:")) {
      if (inTerms) {
        inTerms = false;
        currentTerm = null;
      }
      if (!line.startsWith("  name:")) section = "";
    }

    if (!inTerms && /^\s{4}bioguide:\s*/.test(line)) {
      rec.bioguideId = cleanYamlValue(line.replace(/^\s{4}bioguide:\s*/, ""));
      continue;
    }

    if (section === "name") {
      if (/^\s{4}official_full:\s*/.test(line)) {
        rec.nameOfficial = cleanYamlValue(line.replace(/^\s{4}official_full:\s*/, ""));
        continue;
      }
      if (/^\s{4}first:\s*/.test(line)) {
        rec.nameFirst = cleanYamlValue(line.replace(/^\s{4}first:\s*/, ""));
        continue;
      }
      if (/^\s{4}last:\s*/.test(line)) {
        rec.nameLast = cleanYamlValue(line.replace(/^\s{4}last:\s*/, ""));
        continue;
      }
    }

    if (inTerms) {
      if (/^\s{2}-\s+type:\s*/.test(line)) {
        currentTerm = { type: cleanYamlValue(line.replace(/^\s{2}-\s+type:\s*/, "")) };
        rec.terms.push(currentTerm);
        continue;
      }

      if (currentTerm) {
        const match = line.match(/^\s{4}([a-z_]+):\s*(.+)$/);
        if (match) {
          const [, key, value] = match;
          currentTerm[key] = cleanYamlValue(value);
        }
      }
    }
  }

  pushCurrent();
  return records;
}

function buildHouseMemberRows(records) {
  const slugSeen = new Map();
  const rows = [];

  for (const rec of records) {
    const bioguideId = String(rec.bioguideId || "").trim();
    if (!bioguideId) continue;

    const terms = Array.isArray(rec.terms) ? rec.terms : [];
    if (!terms.length) continue;

    const latestTerm = terms[terms.length - 1];
    if (latestTerm.type !== "rep") continue;

    const name = rec.nameOfficial || [rec.nameFirst, rec.nameLast].filter(Boolean).join(" ").trim();
    if (!name) continue;

    const state = String(latestTerm.state || "").trim();
    if (!state) continue;

    const district = districtLabel(latestTerm.district);
    const districtCode = `${state}-${district}`;

    let slug = slugify(name);
    if (!slug) slug = bioguideId.toLowerCase();
    const seen = slugSeen.get(slug) || 0;
    slugSeen.set(slug, seen + 1);
    if (seen > 0) slug = `${slug}_${seen + 1}`;

    rows.push({
      bioguideId,
      name,
      party: String(latestTerm.party || "").trim(),
      state,
      district,
      districtCode,
      slug,
      photo: "",
      // filled by scripts/fetchUSHousePhotos.js
      votesWithPartyPct: null,
      billsSponsored: 0,
      missedVotesPct: null,
      _districtSort: districtSortValue(latestTerm.district),
    });
  }

  return rows.sort(
    (a, b) =>
      a.state.localeCompare(b.state) ||
      a._districtSort - b._districtSort ||
      a.name.localeCompare(b.name)
  );
}

function splitVotingAndNonVoting(houseRows) {
  const excludedNonVoting = [];
  const votingMembers = [];

  for (const row of houseRows) {
    if (NON_VOTING_HOUSE_CODES.has(row.state)) {
      excludedNonVoting.push(row);
    } else {
      votingMembers.push(row);
    }
  }

  return { votingMembers, excludedNonVoting };
}

async function main() {
  const fetchFn = getFetch();
  const res = await fetchFn(SOURCE_URL, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch source: ${res.status} ${res.statusText}`);
  }

  const yamlText = await res.text();
  const legislators = parseYamlLegislators(yamlText);
  const houseRows = buildHouseMemberRows(legislators);
  const { votingMembers, excludedNonVoting } = splitVotingAndNonVoting(houseRows);

  const finalMembers = votingMembers.map(({ _districtSort, ...row }) => row);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");
  const outputDir = path.join(projectRoot, "data", "us");
  const outputPath = path.join(outputDir, "house_members.json");

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(finalMembers, null, 2)}\n`, "utf8");

  console.log(`Total current House-related entries found: ${houseRows.length}`);
  console.log(`Excluded delegate/non-voting entries: ${excludedNonVoting.length}`);
  for (const row of excludedNonVoting) {
    console.log(`  - ${row.name} (${row.districtCode})`);
  }
  const vacantSeats = 435 - finalMembers.length;
  console.log(`Final voting-member count: ${finalMembers.length}`);
  console.log(`Vacant voting seats: ${vacantSeats}`);
  console.log(`Wrote file: ${outputPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
