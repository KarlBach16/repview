import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const SHARD_COUNT = 32;

function readJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readGzipJson(filePath) {
  return JSON.parse(gunzipSync(readFileSync(filePath)).toString("utf8"));
}

function shardForBillId(value) {
  let hash = 0;
  for (const char of String(value || "").trim()) hash = (hash + char.charCodeAt(0)) % SHARD_COUNT;
  return String(hash).padStart(2, "0");
}

function main() {
  const __filename = fileURLToPath(import.meta.url);
  const root = path.resolve(path.dirname(__filename), "..");
  const outputDir = path.join(root, "data", "kr", "bills");
  const rawBills = readJson(path.join(root, "data", "raw", "bills_raw.json"));
  const summaries = readGzipJson(path.join(root, "data", "raw", "vote_summaries.json.gz"));
  const manifest = readJson(path.join(outputDir, "manifest.json"));
  const profiles = readJson(path.join(outputDir, "members.json"));
  const allBills = new Map();

  for (let index = 0; index < SHARD_COUNT; index += 1) {
    const shardName = String(index).padStart(2, "0");
    const shard = readJson(path.join(outputDir, `${shardName}.json`));
    for (const [billId, bill] of Object.entries(shard)) {
      if (shardForBillId(billId) !== shardName) throw new Error(`Wrong shard for ${billId}`);
      if (allBills.has(billId)) throw new Error(`Duplicate bill detail ${billId}`);
      if (!bill.title || !bill.status) throw new Error(`Incomplete bill detail ${billId}`);
      allBills.set(billId, bill);
    }
  }

  const expectedIds = new Set([
    ...rawBills.map((bill) => String(bill.billId || "").trim()),
    ...summaries.map((summary) => String(summary.billId || "").trim()),
  ].filter(Boolean));
  if (allBills.size !== expectedIds.size || manifest.billCount !== expectedIds.size) {
    throw new Error(`Bill detail count mismatch: ${allBills.size}/${manifest.billCount}/${expectedIds.size}`);
  }
  for (const billId of expectedIds) {
    if (!allBills.has(billId)) throw new Error(`Missing bill detail ${billId}`);
  }

  for (const summary of summaries) {
    const bill = allBills.get(summary.billId);
    if (!bill?.vote) throw new Error(`Missing vote detail ${summary.billId}`);
    const vote = bill.vote;
    if (vote.yes !== Number(summary.yesCount || 0)
      || vote.no !== Number(summary.noCount || 0)
      || vote.abstain !== Number(summary.abstainCount || 0)
      || vote.yes + vote.no + vote.abstain !== Number(summary.voteCount || 0)) {
      throw new Error(`Vote tally mismatch ${summary.billId}`);
    }
  }

  for (const bill of rawBills) {
    const detail = allBills.get(bill.billId);
    const codes = [...(detail.leadCodes || []), ...(detail.cosponsorCodes || [])];
    for (const code of codes) {
      if (!profiles[code]) throw new Error(`Missing sponsor profile ${bill.billId}/${code}`);
    }
  }

  console.log("Bill detail audit passed");
  console.log(`- bill details: ${allBills.size}`);
  console.log(`- voted bills: ${summaries.length}`);
  console.log(`- sponsor profiles: ${Object.keys(profiles).length}`);
}

main();
