import assert from "node:assert/strict";
import worker from "./src/index.js";

class MemoryKV {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }

  async list({ prefix = "" } = {}) {
    return {
      keys: [...this.values.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    };
  }
}

const env = { SEARCH_RANKING_KV: new MemoryKV() };
const viewRequest = () => new Request("https://repview.app/api/kr/member-view", {
  method: "POST",
  headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
  body: JSON.stringify({ slug: "sample_member", anonId: "anonymous_1234" }),
});

const firstView = await worker.fetch(viewRequest(), env);
assert.equal(firstView.status, 200);
assert.equal((await firstView.json()).count, 1);

const duplicateView = await worker.fetch(viewRequest(), env);
assert.equal((await duplicateView.json()).deduped, true);

const monthlyRanking = await worker.fetch(
  new Request("https://repview.app/api/kr/member-ranking?period=month&limit=500"),
  env
);
const monthlyPayload = await monthlyRanking.json();
assert.equal(monthlyPayload.period, "month");
assert.match(monthlyPayload.monthKey, /^\d{4}-\d{2}$/);
assert.equal(monthlyPayload.counts.sample_member, 1);
assert.equal(monthlyPayload.rankings[0].slug, "sample_member");

const weeklyRanking = await worker.fetch(
  new Request("https://repview.app/api/kr/member-ranking?period=week&limit=500"),
  env
);
assert.deepEqual((await weeklyRanking.json()).counts, {});

console.log("Search ranking Worker tests passed.");
