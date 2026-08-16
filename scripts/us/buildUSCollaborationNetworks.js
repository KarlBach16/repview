import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const TARGET_CONGRESS = 119;
const BILL_TYPES = ["hr", "hres", "hjres", "hconres"];
const TOP_COLLABORATORS = 5;
const RECENT_SHARED_BILLS = 4;

const TYPE_META = {
  HR: { label: "H.R.", path: "house-bill" },
  HRES: { label: "H.Res.", path: "house-resolution" },
  HJRES: { label: "H.J.Res.", path: "house-joint-resolution" },
  HCONRES: { label: "H.Con.Res.", path: "house-concurrent-resolution" },
};

function decodeXml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function firstTag(xml, name) {
  const match = String(xml || "").match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
  return decodeXml(match?.[1]?.trim() || "");
}

function section(xml, name) {
  const match = String(xml || "").match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match?.[1] || "";
}

function itemBioguides(xml, { excludeWithdrawn = false } = {}) {
  return [...String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .filter(([, item]) => !excludeWithdrawn || !/<sponsorshipWithdrawnDate>/i.test(item))
    .map(([, item]) => firstTag(item, "bioguideId").toUpperCase())
    .filter(Boolean);
}

function billKey(type, number) {
  return `${String(type || "").toLowerCase()}:${number}`;
}

function pairKey(left, right) {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

async function fetchBuffer(url, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  throw new Error(`Download failed after ${attempts} attempts: ${lastError?.message || lastError} (${url})`);
}

async function downloadAndExtract(type, tempDir) {
  const url = `https://www.govinfo.gov/bulkdata/BILLSTATUS/${TARGET_CONGRESS}/${type}/BILLSTATUS-${TARGET_CONGRESS}-${type}.zip`;
  const zipPath = path.join(tempDir, `${type}.zip`);
  const extractPath = path.join(tempDir, type);
  const archive = await fetchBuffer(url);
  await writeFile(zipPath, archive);
  await execFile("unzip", ["-q", zipPath, "-d", extractPath]);
  const files = (await readdir(extractPath)).filter((name) => name.endsWith(".xml"));
  console.log(`Downloaded ${type.toUpperCase()}: ${files.length} measures`);
  return files.map((name) => path.join(extractPath, name));
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(__filename), "..", "..");
  const membersPath = path.join(projectRoot, "data", "us", "house_members.json");
  const outputPath = path.join(projectRoot, "data", "us", "collaboration_networks.json");
  const members = JSON.parse(await readFile(membersPath, "utf8"));
  const memberByBioguide = new Map(members.map((member) => [
    String(member.bioguideId || "").trim().toUpperCase(),
    member,
  ]));
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "repview-us-collaboration-"));

  try {
    const fileGroups = await Promise.all(BILL_TYPES.map((type) => downloadAndExtract(type, tempDir)));
    const files = fileGroups.flat();
    const billIndex = new Map();
    const participantsByBill = new Map();

    for (let index = 0; index < files.length; index += 1) {
      const xml = await readFile(files[index], "utf8");
      const billXml = section(xml, "bill");
      const type = firstTag(billXml, "type").toUpperCase();
      const number = Number(firstTag(billXml, "number"));
      const meta = TYPE_META[type];
      if (!meta || !Number.isFinite(number)) continue;

      const sponsors = itemBioguides(section(billXml, "sponsors"));
      const cosponsors = itemBioguides(section(billXml, "cosponsors"), { excludeWithdrawn: true });
      const participants = new Set([...sponsors, ...cosponsors].filter((id) => memberByBioguide.has(id)));
      if (participants.size < 2) continue;

      const key = billKey(type, number);
      const billPageLink = firstTag(billXml, "legislationUrl")
        || `https://www.congress.gov/bill/${TARGET_CONGRESS}th-congress/${meta.path}/${number}`;
      const detailLink = billPageLink.endsWith("/text") ? billPageLink : `${billPageLink}/text`;
      billIndex.set(key, {
        billNo: `${meta.label} ${number}`,
        title: firstTag(billXml, "title"),
        proposalDate: firstTag(billXml, "introducedDate").slice(0, 10),
        detailLink,
        leadBioguideId: sponsors[0] || "",
      });
      participantsByBill.set(key, participants);

      if ((index + 1) % 2000 === 0) console.log(`Parsed measures: ${index + 1}/${files.length}`);
    }

    const memberBillIds = new Map([...memberByBioguide.keys()].map((id) => [id, new Set()]));
    const crossPartyBillIds = new Map([...memberByBioguide.keys()].map((id) => [id, new Set()]));
    const pairBillIds = new Map();

    for (const [key, participantSet] of participantsByBill) {
      const participants = [...participantSet];
      const parties = new Set(participants.map((id) => memberByBioguide.get(id)?.party).filter(Boolean));
      for (const id of participants) {
        memberBillIds.get(id).add(key);
        if (parties.size > 1) crossPartyBillIds.get(id).add(key);
      }
      for (let left = 0; left < participants.length; left += 1) {
        for (let right = left + 1; right < participants.length; right += 1) {
          const keyForPair = pairKey(participants[left], participants[right]);
          if (!pairBillIds.has(keyForPair)) pairBillIds.set(keyForPair, new Set());
          pairBillIds.get(keyForPair).add(key);
        }
      }
    }

    const collaboratorsByMember = new Map([...memberByBioguide.keys()].map((id) => [id, []]));
    for (const [key, sharedBills] of pairBillIds) {
      const [left, right] = key.split("|");
      collaboratorsByMember.get(left)?.push({ bioguideId: right, sharedBills });
      collaboratorsByMember.get(right)?.push({ bioguideId: left, sharedBills });
    }

    const outputMembers = {};
    const referencedBillIds = new Set();
    for (const [bioguideId, member] of memberByBioguide) {
      const collaborators = (collaboratorsByMember.get(bioguideId) || []).sort((a, b) => {
        const countDiff = b.sharedBills.size - a.sharedBills.size;
        if (countDiff) return countDiff;
        return String(memberByBioguide.get(a.bioguideId)?.name || "")
          .localeCompare(String(memberByBioguide.get(b.bioguideId)?.name || ""), "en");
      });
      const topCollaborators = collaborators.slice(0, TOP_COLLABORATORS).map((collaborator) => {
        const sharedBillIds = [...collaborator.sharedBills]
          .sort((a, b) => String(billIndex.get(b)?.proposalDate || "").localeCompare(String(billIndex.get(a)?.proposalDate || "")))
          .slice(0, RECENT_SHARED_BILLS);
        sharedBillIds.forEach((id) => referencedBillIds.add(id));
        const other = memberByBioguide.get(collaborator.bioguideId);
        return {
          bioguideId: collaborator.bioguideId,
          billCount: collaborator.sharedBills.size,
          ledByMemberCount: [...collaborator.sharedBills].filter((billId) => billIndex.get(billId)?.leadBioguideId === bioguideId).length,
          ledByCollaboratorCount: [...collaborator.sharedBills].filter((billId) => billIndex.get(billId)?.leadBioguideId === collaborator.bioguideId).length,
          sameParty: member.party === other?.party,
          sharedBillIds,
        };
      });
      outputMembers[bioguideId] = {
        collaborationBillCount: memberBillIds.get(bioguideId)?.size || 0,
        uniqueCollaboratorCount: collaborators.length,
        otherPartyCollaboratorCount: collaborators.filter(({ bioguideId: otherId }) => member.party !== memberByBioguide.get(otherId)?.party).length,
        crossPartyBillCount: crossPartyBillIds.get(bioguideId)?.size || 0,
        topCollaborators,
      };
    }

    const bills = Object.fromEntries([...referencedBillIds].sort().map((key) => [key, billIndex.get(key)]));
    const dataThrough = [...billIndex.values()].map((bill) => bill.proposalDate).filter(Boolean).sort().pop() || "";
    await writeFile(outputPath, `${JSON.stringify({
      congress: TARGET_CONGRESS,
      basis: "official_billstatus_cosponsorship_roster",
      dataThrough,
      bills,
      members: outputMembers,
    }, null, 2)}\n`, "utf8");

    console.log(`Collaboration networks: ${Object.keys(outputMembers).length}`);
    console.log(`Bills with current-member collaboration: ${billIndex.size}`);
    console.log(`Referenced shared bills: ${Object.keys(bills).length}`);
    console.log(`Wrote file: ${outputPath}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
