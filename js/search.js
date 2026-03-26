// ── Search page ────────────────────────────────────────────

let allRepresentatives = [];
let defaultGallery = [];

async function initSearch() {
  initI18n();

  try {
    const data = await loadAll();
    allRepresentatives = data.representatives;
    defaultGallery = shuffled(allRepresentatives);
  } catch (e) {
    document.getElementById("results-list").innerHTML =
      `<p class="search-empty">${t("search.load.error")}</p>`;
    return;
  }

  initNav();

  const input = document.getElementById("search-page-input");
  const urlQ = new URLSearchParams(location.search).get("q") || "";

  if (urlQ) {
    input.value = urlQ;
    renderResults(filterRepresentatives(urlQ), urlQ);
  } else {
    renderResults(defaultGallery, "");
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    history.replaceState(null, "", q ? `?q=${encodeURIComponent(q)}` : location.pathname);
    if (q) {
      renderResults(filterRepresentatives(q), q);
    } else {
      defaultGallery = shuffled(allRepresentatives);
      renderResults(defaultGallery, "");
    }
  });

  window.addEventListener("repview:languagechange", () => {
    const q = input.value.trim();
    renderResults(q ? filterRepresentatives(q) : defaultGallery, q);
  });

  // BFCache 복귀(뒤로가기) 시에도 기본 갤러리를 새로 섞어서 표시.
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    const q = input.value.trim();
    if (q) return;
    defaultGallery = shuffled(allRepresentatives);
    renderResults(defaultGallery, "");
  });

  input.focus();
}

function shuffled(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function filterRepresentatives(q) {
  const needle = q.toLowerCase();
  const norm = (v) => String(v || "").toLowerCase();

  return allRepresentatives.filter((r) => {
    const p = r.profile || {};
    return (
      norm(p.name).includes(needle) ||
      norm(p.district).includes(needle) ||
      norm(p.party).includes(needle)
    );
  });
}

function renderResults(representatives, q) {
  const label = document.getElementById("results-label");
  const list = document.getElementById("results-list");

  if (q) {
    label.textContent = t("search.label.results", {
      count: representatives.length,
      plural: representatives.length !== 1 ? "es" : "",
      query: q
    });
  } else {
    label.textContent = "";
  }

  if (!representatives.length) {
    list.innerHTML = `<p class="search-empty">${t("search.empty", { query: q })}</p>`;
    return;
  }

  list.innerHTML = representatives.map((r) => {
    const p = r.profile || {};
    const photo = p.photo
      ? `<img class="search-result-photo" src="${p.photo}" alt="${p.name}" loading="lazy" />`
      : `<div class="search-result-photo fallback-photo" style="background:${avatarGradient(r)}"></div>`;

    return `
      <article class="search-result-card fade-in" onclick="location.href='member.html?slug=${encodeURIComponent(r.slug)}'">
        <div class="search-result-photo-wrap">${photo}</div>
        <div class="search-result-meta">
          <p class="search-result-name">${p.name || ""}</p>
          <p class="search-result-district">${p.district || ""}</p>
          <p class="search-result-party">${partyAccentHTML(p.party || "")}</p>
        </div>
      </article>`;
  }).join("");

  initFadeIns();
}

document.addEventListener("DOMContentLoaded", initSearch);
