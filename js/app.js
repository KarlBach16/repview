// ── Shared data loader & utilities ────────────────────────

const BASE = "";   // adjust if served from a subpath
const LANG_PREF_KEY = "repview.lang";

const I18N = {
  en: {
    "nav.logo": "RepView",
    "nav.back.repview": "← RepView",
    "nav.back.search": "← Search",
    "index.eyebrow": "District First Civic Storytelling",
    "index.headline": "Find your district representative.",
    "index.sub": "One name. One record. One clear summary.",
    "index.search.placeholder": "Search by district or representative",
    "index.district.hint": "District is the fastest path. Name and country work too.",
    "index.teaser.label": "Poster Preview",
    "search.kicker": "District First Search",
    "search.title": "Start with your district.",
    "search.input.placeholder": "Search district, representative name, or country",
    "search.label.default": "District-first gallery",
    "search.label.results": "{count} district match{plural} for \"{query}\"",
    "search.empty": "No representatives found for \"{query}\".",
    "search.load.error": "Failed to load data.",
    "member.scroll.hint": "Scroll for full record",
    "member.stat.attendance": "Attendance",
    "member.stat.attendance.context": "Plenary sessions over the last 3 months",
    "member.stat.vote": "Vote Participation",
    "member.stat.vote.context": "Votes cast as a share of total votes held",
    "member.stat.bills": "Bills Proposed",
    "member.stat.bills.context": "Primary sponsorship in current term",
    "member.stat.absent": "Absent",
    "member.stat.absent.context": "Missed votes in current term",
    "member.votes.title": "How they voted.",
    "member.votes.sub": "Recent parliamentary votes and their position on each bill.",
    "member.activity.title": "Current Activity",
    "member.share.title": "RepView Summary",
    "member.share.stat.attendance": "Attendance",
    "member.share.stat.vote": "Vote participation",
    "member.share.stat.bills": "Bills proposed",
    "member.share.stat.bills.short": "Bills proposed",
    "member.share.stat.absent": "Absent",
    "member.share.unit.times": "times",
    "member.share.stat.totalVotes": "Total votes",
    "member.share.tendency": "Vote tendency",
    "member.share.choice.support": "Support",
    "member.share.choice.oppose": "Oppose",
    "member.share.choice.abstain": "Abstain",
    "member.bill.recent": "Most Recent Bill",
    "member.bill.none": "No bills proposed in the last 3 months",
    "member.activity.none": "No current activity on record.",
    "member.activity.inprogress": "In Progress",
    "member.activity.upcoming": "Upcoming",
    "member.votes.none": "No vote records available.",
    "member.vote.result.passed": "Passed",
    "member.vote.result.failed": "Failed",
    "member.vote.yes": "✓ Yes",
    "member.vote.no": "✗ No",
    "member.vote.abstain": "— Abstain"
  },
  ko: {
    "nav.logo": "RepView",
    "nav.back.repview": "← RepView",
    "nav.back.search": "← 검색",
    "index.eyebrow": "지역구 중심 정치 스토리텔링",
    "index.headline": "우리 지역 국회의원 찾기",
    "index.sub": "한눈에 보는 활동 기록.",
    "index.search.placeholder": "지역구 또는 국회의원 검색",
    "index.district.hint": "지역구 검색이 가장 빠릅니다. 이름과 국가도 검색할 수 있어요.",
    "index.teaser.label": "대표 포스터 미리보기",
    "search.kicker": "국회의원 찾기",
    "search.title": "지역구 또는 국회의원 이름 검색",
    "search.input.placeholder": "",
    "search.label.default": "지역구 중심 갤러리",
    "search.label.results": "\"{query}\" 검색 결과 {count}건",
    "search.empty": "\"{query}\"에 해당하는 대표를 찾지 못했습니다.",
    "search.load.error": "데이터를 불러오지 못했습니다.",
    "member.scroll.hint": "아래로 내려 전체 기록 보기",
    "member.stat.attendance": "출석률",
    "member.stat.attendance.context": "최근 3개월 본회의 기준",
    "member.stat.vote": "표결 참여율",
    "member.stat.vote.context": "전체 표결 대비 실제 참여 비율",
    "member.stat.bills": "대표 발의 수",
    "member.stat.bills.context": "현 임기 내 대표 발의 기준",
    "member.stat.absent": "불참",
    "member.stat.absent.context": "현 임기 내 표결 불참 횟수",
    "member.votes.title": "이렇게 표결했습니다.",
    "member.votes.sub": "최근 국회 표결과 해당 의원의 선택을 보여줍니다.",
    "member.activity.title": "현재 활동",
    "member.share.title": "RepView 요약",
    "member.share.stat.attendance": "출석률",
    "member.share.stat.vote": "표결 참여율",
    "member.share.stat.bills": "대표 발의 수",
    "member.share.stat.bills.short": "대표 발의",
    "member.share.stat.absent": "불참",
    "member.share.unit.times": "회",
    "member.share.stat.totalVotes": "총 표결 수",
    "member.share.tendency": "표결 성향",
    "member.share.choice.support": "찬성",
    "member.share.choice.oppose": "반대",
    "member.share.choice.abstain": "기권",
    "member.bill.recent": "최근 대표 발의",
    "member.bill.none": "최근 3개월 대표 발의 기록이 없습니다",
    "member.activity.none": "현재 등록된 활동이 없습니다.",
    "member.activity.inprogress": "진행 중",
    "member.activity.upcoming": "예정",
    "member.votes.none": "표결 기록이 없습니다.",
    "member.vote.result.passed": "가결",
    "member.vote.result.failed": "부결",
    "member.vote.yes": "✓ 찬성",
    "member.vote.no": "✗ 반대",
    "member.vote.abstain": "— 기권"
  }
};

async function loadJSON(path) {
  const res = await fetch(BASE + path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function normalizeRepresentative(raw) {
  if (raw && raw.profile && raw.stats) {
    return {
      monaCode: raw.monaCode || "",
      slug: raw.slug || raw.id || "",
      profile: {
        name: raw.profile.name || "",
        party: raw.profile.party || "",
        district: raw.profile.district || "",
        committee: raw.profile.committee || "",
        reelection: raw.profile.reelection || "",
        unit: raw.profile.unit || "",
        photo: raw.profile.photo || "",
        homepage: raw.profile.homepage || "",
      },
      stats: {
        votesTotal: Number(raw.stats.votesTotal || 0),
        votesParticipated: Number(raw.stats.votesParticipated || 0),
        voteParticipationRate: Number(raw.stats.voteParticipationRate || 0),
        billsProposed: Number(raw.stats.billsProposed || 0),
        supportRate: Number(raw.stats.supportRate || 0),
        opposeRate: Number(raw.stats.opposeRate || 0),
        abstainRate: Number(raw.stats.abstainRate || 0),
        absentCount: Number(raw.stats.absentCount || 0),
      },
      recentVotes: Array.isArray(raw.recentVotes) ? raw.recentVotes : [],
      recentBills: Array.isArray(raw.recentBills) ? raw.recentBills : [],
    };
  }

  // Backward compatibility with flat representative rows.
  return {
    monaCode: raw?.monaCode || "",
    slug: raw?.slug || raw?.id || "",
    profile: {
      name: raw?.name || "",
      party: raw?.party || "",
      district: raw?.district || "",
      committee: raw?.committee || "",
      reelection: raw?.reelection || "",
      unit: raw?.unit || "",
      photo: raw?.photo || "",
      homepage: raw?.homepage || "",
    },
    stats: {
      votesTotal: Number(raw?.votesTotal || 0),
      votesParticipated: Number(raw?.votesParticipated || 0),
      voteParticipationRate: Number(raw?.voteParticipationRate || 0),
      billsProposed: Number(raw?.billsProposed || 0),
      supportRate: Number(raw?.supportRate || 0),
      opposeRate: Number(raw?.opposeRate || 0),
      abstainRate: Number(raw?.abstainRate || 0),
      absentCount: Number(raw?.absentCount || 0),
    },
    recentVotes: Array.isArray(raw?.recentVotes) ? raw.recentVotes : [],
    recentBills: Array.isArray(raw?.recentBills) ? raw.recentBills : [],
  };
}

async function loadRepresentatives() {
  const rows = await loadJSON("data/app/representatives.json");
  return Array.isArray(rows) ? rows.map(normalizeRepresentative) : [];
}

async function loadAll() {
  const representatives = await loadRepresentatives();
  return {
    representatives,
    // Keep `members` alias for pages that still call loadAll().
    members: representatives,
    votes: [],
    countries: [],
  };
}

function getAutoLanguage() {
  const langs = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language || "en"];
  const primary = (langs[0] || "en").toLowerCase();
  return primary.startsWith("ko") ? "ko" : "en";
}

function getLanguagePreference() {
  return localStorage.getItem(LANG_PREF_KEY) || "auto";
}

function setLanguagePreference(value) {
  localStorage.setItem(LANG_PREF_KEY, value);
}

function getCurrentLanguage() {
  const pref = getLanguagePreference();
  if (pref === "auto") return getAutoLanguage();
  return I18N[pref] ? pref : "en";
}

function t(key, vars = {}) {
  const lang = getCurrentLanguage();
  const dict = I18N[lang] || I18N.en;
  let text = dict[key] || I18N.en[key] || key;
  Object.entries(vars).forEach(([name, value]) => {
    text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
  });
  return text;
}

function applyI18n(root = document) {
  const lang = getCurrentLanguage();
  root.documentElement?.setAttribute("lang", lang);

  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
  });
}

function syncLanguageSelectors() {
  const pref = getLanguagePreference();
  document.querySelectorAll(".lang-select").forEach((sel) => {
    sel.value = pref;
  });
}

function initLanguageSelector() {
  document.querySelectorAll(".lang-select").forEach((sel) => {
    if (sel.dataset.bound === "1") return;
    sel.dataset.bound = "1";
    sel.addEventListener("change", () => {
      setLanguagePreference(sel.value);
      syncLanguageSelectors();
      applyI18n(document);
      window.dispatchEvent(new Event("repview:languagechange"));
    });
  });
  syncLanguageSelectors();
}

function initI18n() {
  initLanguageSelector();
  applyI18n(document);
}

// ── Avatar helpers ─────────────────────────────────────────

function avatarGradient(member) {
  const color = member.party_color || "#2997ff";
  const dark  = darkenColor(color, 30);
  return `linear-gradient(135deg, ${color}, ${dark})`;
}

function darkenColor(hex, pct) {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = 1 - pct / 100;
  const r = Math.round(((n >> 16) & 0xff) * f);
  const g = Math.round(((n >>  8) & 0xff) * f);
  const b = Math.round(( n        & 0xff) * f);
  return `rgb(${r},${g},${b})`;
}

function countryInfo(countries, code) {
  return countries.find(c => c.code === code) || { flag: "", name: code };
}

function districtLabel(member) {
  const district = member?.profile?.district || member?.district || "";
  const lang = getCurrentLanguage();
  if (lang !== "ko") return district;

  if (!district || district.includes("비례대표")) return district;

  let label = String(district).trim();

  // Remove province/city prefix token (e.g. "경북 ", "경기 ", "서울 ")
  label = label.replace(/^[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도|시)?\s+/, "");

  // Convert patterns like "구미시을" -> "구미", "포항북구갑" -> "포항 북구"
  label = label.replace(/^([가-힣]+)시([가-힣]+)구[갑을병정]$/, "$1 $2구");
  label = label.replace(/^([가-힣]+)(시|군|구)[갑을병정]$/, "$1");
  label = label.replace(/^([가-힣]+)(시|군|구)$/, "$1");

  return label || district;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getPartyColor(party) {
  const p = String(party || "").trim();
  if (p.includes("더불어민주")) return "#1F5BA9";
  if (p.includes("국민의힘")) return "#E61E2B";
  if (p.includes("정의당")) return "#FFCC00";
  if (p.includes("조국혁신")) return "#0073CF";
  if (p.includes("개혁신당")) return "#FF7A00";
  if (p.includes("진보당")) return "#D6001C";
  if (p.includes("기본소득당")) return "#00D2C3";
  if (p.includes("사회민주당")) return "#2E8B57";
  if (p.includes("무소속")) return "#888888";
  return "#9BA3AF";
}

function partyAccentHTML(party) {
  const safeParty = escapeHTML(party || "");
  const color = getPartyColor(party);
  return `<span class="party-accent" style="color:${color}">
    <span class="party-dot" style="background-color:${color}"></span>${safeParty}
  </span>`;
}

// ── Scroll-based nav transparency ─────────────────────────

function initNav() {
  const nav = document.querySelector(".nav");
  if (!nav) return;
  window.addEventListener("scroll", () => {
    nav.classList.toggle("scrolled", window.scrollY > 20);
  }, { passive: true });
}

// ── IntersectionObserver for fade-ins ─────────────────────

function initFadeIns() {
  const els = document.querySelectorAll(".fade-in");
  if (!els.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("visible");
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.15 });

  els.forEach(el => observer.observe(el));
}

// ── Number counter animation ───────────────────────────────

function animateCount(el, target, suffix = "") {
  const duration = 1400;
  const start    = performance.now();

  function step(now) {
    const elapsed = Math.min(now - start, duration);
    const progress = elapsed / duration;
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(target * eased);
    el.textContent = current + suffix;
    if (elapsed < duration) requestAnimationFrame(step);
    else el.textContent = target + suffix;
  }
  requestAnimationFrame(step);
}

function initCounters() {
  const els = document.querySelectorAll("[data-count]");
  if (!els.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const target = parseFloat(e.target.dataset.count);
        const suffix = e.target.dataset.suffix || "";
        animateCount(e.target, target, suffix);
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.5 });

  els.forEach(el => observer.observe(el));
}
