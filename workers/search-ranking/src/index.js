const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "https://repview.app",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...CORS_HEADERS,
    },
  });
}

function error(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function getKSTWeekKey(now = new Date()) {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utcMs + 9 * 60 * 60000);

  const day = (kst.getDay() + 6) % 7; // Monday=0
  kst.setDate(kst.getDate() - day);
  kst.setHours(0, 0, 0, 0);

  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getMinuteBucket(now = Date.now()) {
  return Math.floor(now / 60000);
}

function parseSlug(raw) {
  const slug = String(raw || "").trim();
  if (!slug) return "";
  if (!/^[a-z0-9_-]+$/i.test(slug)) return "";
  return slug.toLowerCase();
}

function parseAnonId(raw) {
  const anonId = String(raw || "").trim();
  if (!anonId) return "";
  if (!/^[a-z0-9_-]{8,128}$/i.test(anonId)) return "";
  return anonId.toLowerCase();
}

function getClientIp(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return ip.replace(/[^0-9a-fA-F:.]/g, "_");
}

function makeWeekSlugKey(weekKey, slug) {
  return `week:${weekKey}:slug:${slug}`;
}

async function isRateLimited(request, env) {
  const ip = getClientIp(request);
  const bucket = getMinuteBucket();
  const key = `rl:${bucket}:ip:${ip}`;

  const current = Number((await env.SEARCH_RANKING_KV.get(key)) || 0);
  const next = current + 1;

  await env.SEARCH_RANKING_KV.put(key, String(next), { expirationTtl: 120 });

  return next > 30;
}

async function handleMemberView(request, env) {
  if (await isRateLimited(request, env)) {
    return json({ ok: true, skipped: "rate_limited" });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return error("invalid_json", 400);
  }

  const slug = parseSlug(body?.slug);
  const anonId = parseAnonId(body?.anonId);
  if (!slug) return error("invalid_slug", 400);
  if (!anonId) return error("invalid_anon_id", 400);

  const weekKey = getKSTWeekKey();

  const dedupeKey = `dedupe:${weekKey}:slug:${slug}:anon:${anonId}`;
  const seen = await env.SEARCH_RANKING_KV.get(dedupeKey);
  if (seen) {
    return json({ ok: true, deduped: true, weekKey, slug });
  }

  await env.SEARCH_RANKING_KV.put(dedupeKey, "1", {
    expirationTtl: 60 * 60 * 12,
  });

  const key = makeWeekSlugKey(weekKey, slug);

  // KV has no atomic increment; acceptable for trend ranking.
  const current = Number((await env.SEARCH_RANKING_KV.get(key)) || 0);
  const next = current + 1;

  await env.SEARCH_RANKING_KV.put(key, String(next), {
    expirationTtl: 60 * 60 * 24 * 120,
  });

  return json({ ok: true, weekKey, slug, count: next });
}

async function listWeekCounts(env, weekKey) {
  const prefix = `week:${weekKey}:slug:`;
  const counts = {};

  let cursor = undefined;
  do {
    const page = await env.SEARCH_RANKING_KV.list({ prefix, cursor, limit: 1000 });
    cursor = page.list_complete ? undefined : page.cursor;

    await Promise.all(
      page.keys.map(async (k) => {
        const slug = k.name.slice(prefix.length);
        if (!slug) return;

        const n = Number((await env.SEARCH_RANKING_KV.get(k.name)) || 0);
        if (n > 0) counts[slug] = n;
      })
    );
  } while (cursor);

  return counts;
}

async function handleMemberRanking(request, env) {
  const url = new URL(request.url);
  const period = String(url.searchParams.get("period") || "week").toLowerCase();
  if (period !== "week") return error("unsupported_period", 400);

  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));
  const weekKey = getKSTWeekKey();
  const counts = await listWeekCounts(env, weekKey);

  const rankings = Object.entries(counts)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([slug, count], idx) => ({ rank: idx + 1, slug, count }));

  return json({
    ok: true,
    period,
    weekKey,
    rankings,
    counts,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    // New endpoints
    if (path === "/api/kr/member-view" && request.method === "POST") {
      return handleMemberView(request, env);
    }

    if (path === "/api/kr/member-ranking" && request.method === "GET") {
      return handleMemberRanking(request, env);
    }

    // Backward compatibility
    if (path === "/api/kr/search-hit" && request.method === "POST") {
      return handleMemberView(request, env);
    }

    if (path === "/api/kr/search-ranking" && request.method === "GET") {
      return handleMemberRanking(request, env);
    }

    return error("not_found", 404);
  },
};
