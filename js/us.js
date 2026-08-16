import { fetchUSMonthlyViewCounts, usRankingKey } from "./us-ranking.js";

const PUBLIC_CONFIG = window.REPVIEW_PUBLIC_CONFIG || {};
const GEOCODIO_API_KEY = PUBLIC_CONFIG.GEOCODIO_API_KEY || "";

async function loadUSMembers() {
  const res = await fetch("/data/us/house_members.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load US members: ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

function escapeHTML(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getUSPartyColor(party) {
  const p = String(party || "").toLowerCase();
  if (p.includes("democrat")) return "#1E4AA8";
  if (p.includes("republican")) return "#E81B23";
  if (p.includes("independent")) return "#6B7280";
  if (p.includes("libertarian")) return "#F5B301";
  if (p.includes("green")) return "#2E8B57";
  if (p.includes("working families")) return "#B23AEE";
  return "#8B93A7";
}

function usPartyAccentHTML(party) {
  const label = String(party || "").trim() || "Unknown";
  const color = getUSPartyColor(label);
  return (
    '<span style="color:' +
    color +
    ';display:inline-flex;align-items:center;gap:8px">' +
    '<span style="width:8px;height:8px;border-radius:999px;background:' +
    color +
    ';display:inline-block;transform:translateY(-1px)"></span>' +
    escapeHTML(label) +
    "</span>"
  );
}

function normalizeDistrictCode(value) {
  let v = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, "");

  if (!v) return "";

  const noDash = v.match(/^([A-Z]{2})(\d+|AL)$/);
  if (noDash) {
    const state = noDash[1];
    const raw = noDash[2];
    const district = raw === "AL" ? "AL" : String(Number(raw));
    return `${state}-${district}`;
  }

  const withDash = v.match(/^([A-Z]{2})-(\d+|AL)$/);
  if (withDash) {
    const state = withDash[1];
    const raw = withDash[2];
    const district = raw === "AL" ? "AL" : String(Number(raw));
    return `${state}-${district}`;
  }

  return v;
}

function memberDetailRoute(districtCode) {
  const code = normalizeDistrictCode(districtCode).toLowerCase();
  return `/us/member.html?district=${encodeURIComponent(code)}`;
}

function formatRankingUSD(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    const digits = abs >= 10_000_000 ? 1 : 2;
    return `$${(amount / 1_000_000).toFixed(digits).replace(/\.0+$|0+$/g, "").replace(/\.$/, "")}M`;
  }
  if (abs >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function rankingScore(member, metric, viewCounts) {
  if (metric === "views") return Number(viewCounts[usRankingKey(member.districtCode)] || 0);
  if (metric === "party") return Number(member.partyDifferentVotesCount || 0);
  if (metric === "fundraising") return Number(member.campaignFinance?.totalReceipts || 0);
  return 0;
}

function rankingValue(member, metric, viewCounts) {
  const score = rankingScore(member, metric, viewCounts);
  if (metric === "views") return `${Math.round(score).toLocaleString("en-US")}`;
  if (metric === "party") return `${Math.round(score)}`;
  return formatRankingUSD(score);
}

function rankingValueLabel(metric) {
  if (metric === "views") return "views this month";
  if (metric === "party") return "votes against party majority";
  return "raised";
}

function rankingContext(member, metric) {
  if (metric === "views") return "";
  if (metric === "party") {
    return `Across ${Number(member.partyComparableVotesCount || 0).toLocaleString("en-US")} comparable House votes.`;
  }
  const finance = member.campaignFinance || {};
  const cycle = Number(finance.cycle);
  const cycleLabel = Number.isFinite(cycle) ? `${cycle - 1}–${cycle}` : "Latest cycle";
  const through = finance.coverageEndDate ? ` · through ${String(finance.coverageEndDate).slice(0, 10)}` : "";
  return `${cycleLabel}${through}`;
}

function renderUSRanking(members, metric, viewCounts) {
  const list = document.getElementById("us-ranking-list");
  if (!list) return;

  const rows = [...members]
    .filter((member) => metric !== "views" || rankingScore(member, metric, viewCounts) > 0)
    .sort((a, b) => {
      const scoreDiff = rankingScore(b, metric, viewCounts) - rankingScore(a, metric, viewCounts);
      if (scoreDiff) return scoreDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    })
    .slice(0, 10);

  if (!rows.length) {
    list.innerHTML = `
      <div class="us-ranking-empty">
        <strong>Monthly views are collecting now.</strong>
        <span>Representatives will appear after readers open their profiles.</span>
      </div>`;
    return;
  }

  list.innerHTML = rows.map((member, index) => {
    const baseRoute = memberDetailRoute(member.districtCode);
    const route = metric === "party" ? `${baseRoute}&view=party-breaks` : baseRoute;
    const photo = member.photo
      ? `<img class="us-ranking-photo" src="${escapeHTML(member.photo)}" alt="${escapeHTML(member.name)}" loading="lazy" />`
      : `<div class="us-ranking-photo us-ranking-photo--fallback">${escapeHTML((member.name || "?")[0])}</div>`;
    return `
      <a class="us-ranking-item" href="${route}">
        <span class="us-ranking-rank">${index + 1}</span>
        <span class="us-ranking-photo-wrap">${photo}</span>
        <span class="us-ranking-member-copy">
          <strong>${escapeHTML(member.name)}</strong>
          <small>${escapeHTML(member.districtCode)} · ${escapeHTML(member.party)}</small>
          ${rankingContext(member, metric) ? `<em>${escapeHTML(rankingContext(member, metric))}</em>` : ""}
        </span>
        <span class="us-ranking-metric">
          <strong>${escapeHTML(rankingValue(member, metric, viewCounts))}</strong>
          <small>${escapeHTML(rankingValueLabel(metric))}</small>
        </span>
      </a>`;
  }).join("");
}

async function initUSRanking(members) {
  const tabs = document.getElementById("us-ranking-tabs");
  if (!tabs) return;

  let metric = "views";
  const viewCounts = await fetchUSMonthlyViewCounts();

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-us-ranking-metric]");
    if (!button) return;
    const nextMetric = button.getAttribute("data-us-ranking-metric");
    if (!new Set(["views", "party", "fundraising"]).has(nextMetric)) return;
    metric = nextMetric;
    tabs.querySelectorAll("[data-us-ranking-metric]").forEach((tab) => {
      tab.classList.toggle("is-active", tab === button);
    });
    renderUSRanking(members, metric, viewCounts);
  });

  renderUSRanking(members, metric, viewCounts);
}

function isZipQuery(value) {
  return /^\d{5}$/.test(String(value || "").trim());
}

function looksLikeZipCandidate(value) {
  return /^\d[\d-]*$/.test(String(value || "").trim());
}

function setSearchMessage(message) {
  const el = document.getElementById("us-search-message");
  if (!el) return;
  el.textContent = message || "";
}

function clearResults() {
  const el = document.getElementById("us-results");
  if (!el) return;
  el.innerHTML = "";
}

function renderResults(rows) {
  const el = document.getElementById("us-results");
  if (!el) return;

  if (!rows.length) {
    el.innerHTML = "";
    return;
  }

  const cards = rows
    .slice(0, 18)
    .map((m) => {
      const route = memberDetailRoute(m.districtCode);
      const photoHTML = m.photo
        ? `<img class="search-result-photo" src="${escapeHTML(m.photo)}" alt="${escapeHTML(m.name)}" loading="lazy" />`
        : `<div class="search-result-photo fallback-photo" style="display:flex;align-items:center;justify-content:center;font-size:56px;color:rgba(245,245,247,0.18);background:#111">${escapeHTML((m.name || "?")[0])}</div>`;
      return `
        <a class="search-result-card" href="${route}">
          <div class="search-result-photo-wrap">${photoHTML}</div>
          <div class="search-result-meta">
            <p class="search-result-name">${escapeHTML(m.name)}</p>
            <p class="search-result-district">${escapeHTML(m.districtCode)}</p>
            <p class="search-result-party">${usPartyAccentHTML(m.party)}</p>
          </div>
        </a>
      `;
    })
    .join("");

  el.innerHTML = `<div class="search-results-grid">${cards}</div>`;
}

function renderZipChoices(districtCodes, members) {
  const el = document.getElementById("us-results");
  if (!el) return;

  const uniqueCodes = [...new Set(districtCodes.map((d) => normalizeDistrictCode(d)).filter(Boolean))];
  const matched = uniqueCodes
    .map((dc) => {
      const member = members.find((m) => normalizeDistrictCode(m.districtCode) === dc);
      return { districtCode: dc, member };
    })
    .filter((x) => x.member);

  if (!matched.length) {
    el.innerHTML = "";
    return;
  }

  const links = matched
    .map((x) => {
      const route = memberDetailRoute(x.member.districtCode);
      return `<a class="district-chip" href="${route}" style="text-decoration:none">${escapeHTML(x.member.districtCode)}</a>`;
    })
    .join("");

  el.innerHTML = `
    <p class="search-empty" style="margin:0 0 8px 0">Enter full address for accurate match.</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;padding-top:4px">
      ${links}
    </div>
  `;
}

function districtCodeFromGeocodioItem(item, result) {
  const stateFromLegislator = item?.current_legislators?.[0]?.bio?.state;
  const stateFromAddress = result?.address_components?.state;
  const state = String(stateFromLegislator || stateFromAddress || "").toUpperCase();

  const rawDistrict = item?.district_number;
  const district = rawDistrict === null || rawDistrict === undefined || Number(rawDistrict) === 0
    ? "AL"
    : String(Number(rawDistrict));

  if (!state || !district) return "";
  return normalizeDistrictCode(`${state}-${district}`);
}

async function lookupZip(zip) {
  if (!GEOCODIO_API_KEY || GEOCODIO_API_KEY === "YOUR_GEOCODIO_API_KEY") {
    throw new Error("GEOCODIO_KEY_MISSING");
  }

  const url = new URL("https://api.geocod.io/v1.7/geocode");
  url.searchParams.set("q", zip);
  url.searchParams.set("fields", "cd");
  url.searchParams.set("api_key", GEOCODIO_API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("GEOCODIO_FAILED");

  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results : [];
  if (!results.length) throw new Error("NO_RESULTS");

  const districtCodes = [];
  for (const result of results) {
    const cds = Array.isArray(result?.fields?.congressional_districts)
      ? result.fields.congressional_districts
      : [];

    for (const cd of cds) {
      const dc = districtCodeFromGeocodioItem(cd, result);
      if (dc) districtCodes.push(dc);
    }
  }

  const uniqueDistrictCodes = [...new Set(districtCodes.map((d) => normalizeDistrictCode(d)).filter(Boolean))];
  if (!uniqueDistrictCodes.length) throw new Error("NO_RESULTS");

  return {
    districtCodes: uniqueDistrictCodes,
    raw: data,
  };
}

async function runZipSearch(zip, members) {
  try {
    console.log("[ZIP DEBUG] input:", zip);
    setSearchMessage("Looking up ZIP...");
    clearResults();

    // TODO: Prefer full street address lookup over ZIP-only lookup when ZIP is ambiguous.
    const zipResult = await lookupZip(zip);
    console.log("[ZIP DEBUG] raw API response:", zipResult.raw);
    console.log("[ZIP DEBUG] extracted districts:", zipResult.districtCodes);

    const sampleCodes = members.slice(0, 15).map((m) => m.districtCode);
    console.log("[ZIP DEBUG] sample districtCode values:", sampleCodes);

    const matchedMembers = zipResult.districtCodes
      .map((dc) => members.find((m) => normalizeDistrictCode(m.districtCode) === normalizeDistrictCode(dc)))
      .filter(Boolean);

    const uniqueMatched = [
      ...new Map(matchedMembers.map((m) => [normalizeDistrictCode(m.districtCode), m])).values(),
    ];

    console.log("[ZIP DEBUG] final matched member(s):", uniqueMatched);

    if (uniqueMatched.length === 1) {
      setSearchMessage("1 district found. Select the representative card below.");
      renderResults(uniqueMatched);
      return;
    }

    if (uniqueMatched.length > 1) {
      setSearchMessage("This ZIP code may map to multiple House districts.");
      renderResults(uniqueMatched);
      return;
    }

    setSearchMessage("No district found for this ZIP code.");
    clearResults();
  } catch (err) {
    console.log("[ZIP DEBUG] lookup error:", err);
    if (err?.message === "NO_RESULTS") {
      setSearchMessage("No district found for this ZIP code.");
    } else if (err?.message === "GEOCODIO_KEY_MISSING") {
      setSearchMessage("Geocodio ZIP lookup is not configured.");
    } else {
      setSearchMessage("Enter full address for accurate match.");
    }
    clearResults();
  }
}

async function initUSPage() {
  let members = [];
  try {
    members = await loadUSMembers();
  } catch (err) {
    console.error(err);
    const el = document.getElementById("us-results");
    if (el) el.innerHTML = '<p class="search-empty">Failed to load house member dataset.</p>';
    return;
  }

  const form = document.getElementById("us-search-form");
  const input = document.getElementById("us-search-input");
  if (!input) return;
  initUSRanking(members);

  const runNameSearch = () => {
    const raw = String(input.value || "").trim();
    const q = raw.toLowerCase();

    if (!q) {
      setSearchMessage("");
      clearResults();
      return;
    }

    if (isZipQuery(raw)) {
      setSearchMessage("Press Enter to search by ZIP");
      clearResults();
      return;
    }

    const filtered = members.filter((m) => {
      const name = String(m.name || "").toLowerCase();
      const districtCode = String(m.districtCode || "").toLowerCase();
      const state = String(m.state || "").toLowerCase();
      return name.includes(q) || districtCode.includes(q) || state === q;
    });

    if (!filtered.length) {
      setSearchMessage("No matching members found.");
      clearResults();
      return;
    }

    setSearchMessage("");
    renderResults(filtered);
  };

  input.addEventListener("input", runNameSearch);

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = String(input.value || "").trim();
      if (!raw) {
        setSearchMessage("");
        clearResults();
        return;
      }

      if (isZipQuery(raw)) {
        await runZipSearch(raw, members);
        return;
      }

      if (looksLikeZipCandidate(raw)) {
        setSearchMessage("Enter a valid 5-digit ZIP code.");
        clearResults();
        return;
      }

      runNameSearch();
    });
  }
}

document.addEventListener("DOMContentLoaded", initUSPage);
