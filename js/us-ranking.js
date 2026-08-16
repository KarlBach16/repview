const US_RANKING_API_BASE = "/api/kr";
const US_VIEW_DEDUPE_KEY = "repview.us.view.dedupe";
const ANON_ID_KEY = "repview.anon.id";

export function usRankingKey(districtCode) {
  const normalized = String(districtCode || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized ? `us_${normalized}` : "";
}

function getAnonId() {
  try {
    const existing = String(localStorage.getItem(ANON_ID_KEY) || "").trim();
    if (/^[a-z0-9_-]{8,128}$/i.test(existing)) return existing;
    const generated = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID().replace(/-/g, "_")
      : `anon_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(ANON_ID_KEY, generated);
    return generated;
  } catch (_) {
    return `anon_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function shouldTrackView(key, dedupeMs = 12 * 60 * 60 * 1000) {
  if (!key) return false;
  const now = Date.now();
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(US_VIEW_DEDUPE_KEY) || "{}") || {};
  } catch (_) {
    store = {};
  }

  Object.keys(store).forEach((storedKey) => {
    if (now - Number(store[storedKey] || 0) > 2 * dedupeMs) delete store[storedKey];
  });

  const last = Number(store[key] || 0);
  if (last && now - last < dedupeMs) {
    try { localStorage.setItem(US_VIEW_DEDUPE_KEY, JSON.stringify(store)); } catch (_) { /* ignore */ }
    return false;
  }

  store[key] = now;
  try { localStorage.setItem(US_VIEW_DEDUPE_KEY, JSON.stringify(store)); } catch (_) { /* ignore */ }
  return true;
}

export function trackUSMemberView(districtCode, { dwellMs = 5000 } = {}) {
  const key = usRankingKey(districtCode);
  if (!key || !shouldTrackView(key)) return;

  const payload = JSON.stringify({ slug: key, anonId: getAnonId() });
  setTimeout(() => {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          `${US_RANKING_API_BASE}/member-view`,
          new Blob([payload], { type: "application/json" })
        );
        return;
      }
      fetch(`${US_RANKING_API_BASE}/member-view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch (_) {
      // Ranking must never block the member page.
    }
  }, Math.max(0, Number(dwellMs) || 0));
}

export async function fetchUSMonthlyViewCounts() {
  try {
    const url = new URL(`${US_RANKING_API_BASE}/member-ranking`, window.location.origin);
    url.searchParams.set("period", "month");
    url.searchParams.set("limit", "500");
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) throw new Error(`ranking api failed: ${response.status}`);
    const json = await response.json();
    const rawCounts = json && typeof json.counts === "object" ? json.counts : {};
    const counts = {};
    Object.entries(rawCounts).forEach(([key, value]) => {
      if (key.startsWith("us_")) counts[key] = Number(value) || 0;
    });
    return counts;
  } catch (_) {
    return {};
  }
}
