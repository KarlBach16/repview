const CIVIC_API_KEY = "AIzaSyBvUTjfiymsCslwfREiiHYP3om8Zs_IFLY";

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

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function memberDetailRoute(districtCode) {
  const code = normalizeDistrictCode(districtCode);
  return `/us/member.html?district=${encodeURIComponent(code)}`;
}

function isZipQuery(value) {
  return /^\d{5}(-\d{4})?$/.test(String(value || "").trim());
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

function districtCodeFromDivisionId(divisionId) {
  const text = String(divisionId || "");
  const match = text.match(/state:([a-z]{2})(?:\/cd:(\d+))?/i);
  if (!match) return "";

  const state = String(match[1] || "").toUpperCase();
  const districtRaw = match[2];
  const district = districtRaw === undefined || districtRaw === null
    ? "AL"
    : String(Number(districtRaw));

  if (!state || !district) return "";
  return `${state}-${district}`;
}

async function lookupZip(zip) {
  if (!CIVIC_API_KEY || CIVIC_API_KEY === "YOUR_API_KEY") {
    throw new Error("MISSING_API_KEY");
  }

  const url = new URL("https://www.googleapis.com/civicinfo/v2/representatives");
  url.searchParams.set("key", CIVIC_API_KEY);
  url.searchParams.set("address", zip);
  url.searchParams.set("roles", "legislatorLowerBody");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("CIVIC_API_FAILED");

  const data = await res.json();
  const officials = Array.isArray(data.officials) ? data.officials : [];
  const offices = Array.isArray(data.offices) ? data.offices : [];

  const indices = [];
  const districtCodes = [];

  for (const office of offices) {
    const idx = Array.isArray(office.officialIndices) ? office.officialIndices : [];
    indices.push(...idx);

    const dc = districtCodeFromDivisionId(office.divisionId);
    if (dc) districtCodes.push(dc);
  }

  const uniqueOfficials = [...new Set(indices)]
    .map((i) => officials[i])
    .filter(Boolean);

  if (!uniqueOfficials.length) {
    throw new Error("MULTIPLE_OR_NOT_FOUND");
  }

  const uniqueDistrictCodes = [...new Set(districtCodes.map((d) => d.toUpperCase()))];
  if (uniqueDistrictCodes.length > 1) {
    throw new Error("MULTIPLE_OR_NOT_FOUND");
  }

  const officialName = String(uniqueOfficials[0]?.name || "").trim();

  return {
    districtCode: uniqueDistrictCodes[0] || "",
    memberName: officialName,
  };
}

function findMemberByDistrictCode(districtCode, members) {
  const target = normalizeDistrictCode(districtCode);
  if (!target) return null;
  return members.find((m) => normalizeDistrictCode(m.districtCode) === target) || null;
}

function findMemberByName(memberName, members) {
  const raw = String(memberName || "").trim().toLowerCase();
  const exact = members.filter((m) => String(m.name || "").trim().toLowerCase() === raw);
  if (exact.length === 1) return exact[0];

  const normalizedTarget = normalizeName(memberName);
  const normalized = members.filter((m) => normalizeName(m.name) === normalizedTarget);
  if (normalized.length === 1) return normalized[0];

  if (exact.length > 1 || normalized.length > 1) return null;

  const contains = members.filter((m) => normalizeName(m.name).includes(normalizedTarget));
  if (contains.length === 1) return contains[0];

  return null;
}

async function runZipSearch(zip, members) {
  try {
    setSearchMessage("Looking up ZIP...");
    clearResults();

    const zipResult = await lookupZip(zip);
    let matched = findMemberByDistrictCode(zipResult.districtCode, members);

    if (!matched && zipResult.memberName) {
      matched = findMemberByName(zipResult.memberName, members);
    }

    if (!matched || !matched.districtCode) {
      setSearchMessage("Enter full address for accurate district");
      return;
    }

    location.href = memberDetailRoute(matched.districtCode);
  } catch (err) {
    setSearchMessage("Enter full address for accurate district");
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

      runNameSearch();
    });
  }
}

document.addEventListener("DOMContentLoaded", initUSPage);
