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
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function memberDetailRoute(districtCode) {
  const code = normalizeDistrictCode(districtCode);
  return `/us/member.html?district=${encodeURIComponent(code)}`;
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
    el.innerHTML = '<p class="search-empty">No matching members found.</p>';
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

  const uniqueCodes = [...new Set(districtCodes.map((d) => String(d || "").toUpperCase()))];
  const matched = uniqueCodes
    .map((dc) => {
      const member = members.find((m) => normalizeDistrictCode(m.districtCode) === normalizeDistrictCode(dc));
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
  return `${state}-${district}`;
}

async function lookupZip(zip) {
  if (!GEOCODIO_API_KEY || GEOCODIO_API_KEY === "YOUR_GEOCODIO_API_KEY") {
    throw new Error("MISSING_API_KEY");
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

  const uniqueDistrictCodes = [...new Set(districtCodes.map((d) => d.toUpperCase()))];
  if (!uniqueDistrictCodes.length) throw new Error("NO_RESULTS");

  return uniqueDistrictCodes;
}

async function runZipSearch(zip, members) {
  try {
    setSearchMessage("Looking up ZIP...");
    clearResults();

    // TODO: Prefer full street address lookup over ZIP-only lookup when ZIP is ambiguous.
    const districtCodes = await lookupZip(zip);

    const matchedMembers = districtCodes
      .map((dc) => members.find((m) => normalizeDistrictCode(m.districtCode) === normalizeDistrictCode(dc)))
      .filter(Boolean);

    const uniqueMatched = [
      ...new Map(matchedMembers.map((m) => [normalizeDistrictCode(m.districtCode), m])).values(),
    ];

    if (uniqueMatched.length === 1) {
      location.href = memberDetailRoute(uniqueMatched[0].districtCode);
      return;
    }

    if (uniqueMatched.length > 1) {
      setSearchMessage("This ZIP code may map to multiple House districts.");
      renderZipChoices(districtCodes, members);
      return;
    }

    setSearchMessage("No district found for this ZIP code.");
    clearResults();
  } catch (err) {
    if (err?.message === "NO_RESULTS") {
      setSearchMessage("No district found for this ZIP code.");
    } else if (err?.message === "MISSING_API_KEY") {
      setSearchMessage("ZIP lookup is not configured.");
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

    setSearchMessage("");
    const filtered = members.filter((m) => {
      const name = String(m.name || "").toLowerCase();
      const districtCode = String(m.districtCode || "").toLowerCase();
      const state = String(m.state || "").toLowerCase();
      return name.includes(q) || districtCode.includes(q) || state === q;
    });

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
