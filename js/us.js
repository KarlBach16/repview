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
  return '<span style="color:' + color + ';display:inline-flex;align-items:center;gap:8px">' +
    '<span style="width:8px;height:8px;border-radius:999px;background:' + color + ';display:inline-block;transform:translateY(-1px)"></span>' +
    escapeHTML(label) +
    '</span>';
}

function normalizeDistrictCode(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function memberDetailRoute(districtCode) {
  const code = normalizeDistrictCode(districtCode);
  return `./member.html?district=${encodeURIComponent(code)}`;
}

function isZipQuery(value) {
  return /^\d{5}(-\d{4})?$/.test(String(value || "").trim());
}

function renderMessage(message) {
  const el = document.getElementById("us-results");
  if (!el) return;
  el.innerHTML = message ? `<p class="search-empty">${escapeHTML(message)}</p>` : "";
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

  const input = document.getElementById("us-search-input");
  if (!input) return;

  const runSearch = () => {
    const raw = String(input.value || "").trim();
    const q = raw.toLowerCase();

    if (!q) {
      renderMessage("");
      return;
    }

    if (isZipQuery(raw)) {
      renderMessage("ZIP lookup is coming next. For now, search by member name or district code.");
      return;
    }

    const filtered = members.filter((m) => {
      const name = String(m.name || "").toLowerCase();
      const districtCode = String(m.districtCode || "").toLowerCase();
      const state = String(m.state || "").toLowerCase();
      return name.includes(q) || districtCode.includes(q) || state === q;
    });
    renderResults(filtered);
  };

  input.addEventListener("input", runSearch);
}

document.addEventListener("DOMContentLoaded", initUSPage);
