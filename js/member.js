// ── Member detail page logic ───────────────────────────────
let currentRepresentative = null;

async function initMember() {
  initI18n();

  const params = new URLSearchParams(location.search);
  const slug = params.get("slug");
  const legacyId = params.get("id");
  const key = slug || legacyId;
  if (!key) {
    location.href = "index.html";
    return;
  }

  let data;
  try {
    data = await loadAll();
  } catch (e) {
    console.error("Data load error:", e);
    document.title = "Error — RepView";
    return;
  }

  const rep = data.representatives.find((r) => r.slug === key || r.monaCode === key);
  if (!rep) {
    location.href = "/pages/kr/index.html";
    return;
  }

  currentRepresentative = rep;
  renderMember(rep);
  initShareActions();
  initNav();
  initNavMemberName(rep.profile.name);
  initFadeIns();
  initCounters();

  window.addEventListener("repview:languagechange", () => {
    if (!currentRepresentative) return;
    renderMember(currentRepresentative);
    initFadeIns();
  });
}

function initNavMemberName(name) {
  const el = document.getElementById("nav-member-name");
  if (!el) return;
  el.textContent = name;

  const threshold = window.innerHeight * 0.6;
  window.addEventListener(
    "scroll",
    () => {
      el.classList.toggle("visible", window.scrollY > threshold);
    },
    { passive: true }
  );
}

function formatVoteDate(value) {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return String(value);
}

function formatProposalDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function renderMember(rep) {
  const p = rep.profile;
  const s = rep.stats;

  document.title = `${p.name} — RepView`;

  const heroPhoto = document.getElementById("hero-photo");
  heroPhoto.src = p.photo || "";
  heroPhoto.alt = p.name || "";

  document.getElementById("hero-committee").textContent = p.committee || "";
  document.getElementById("hero-name").textContent = p.name || "";
  document.getElementById("hero-meta").innerHTML = `
    ${escapeHTML(p.district || "")}&nbsp;&nbsp;${partyAccentHTML(p.party || "")}
  `;

  // Keep current layout; map summary metrics to merged stats.
  document.getElementById("stat-attendance").dataset.count = String(s.voteParticipationRate || 0);
  document.getElementById("stat-vote").dataset.count = String(s.billsProposed || 0);
  document.getElementById("stat-vote").dataset.suffix = "";
  document.getElementById("stat-bills").dataset.count = String(s.absentCount || 0);
  document.getElementById("stat-bills").dataset.suffix = "";

  const billBlock = document.getElementById("bill-callout");
  if (Array.isArray(rep.recentBills) && rep.recentBills.length) {
    const first = rep.recentBills[0];
    const status = first.status || first.billStatus || "";
    billBlock.innerHTML = `
      <div class="bill-callout-label">${t("member.bill.recent")}</div>
      <div class="bill-callout-title">${first.title || ""}</div>
      <span class="bill-status-badge">
        <span class="bill-status-dot"></span>${status || "-"}
      </span>`;
  } else {
    billBlock.innerHTML = `<div style="font-size:15px;color:var(--text-muted-light)">${t("member.bill.none")}</div>`;
  }

  renderVotes(rep.recentVotes || []);
  renderBills(rep.recentBills || []);
  renderShareCard(rep);
}

function renderVotes(votes) {
  const list = document.getElementById("vote-list");
  if (!votes.length) {
    list.innerHTML = `<p style="color:rgba(245,245,247,0.3);font-size:15px;padding:20px 0">${t("member.votes.none")}</p>`;
    return;
  }

  list.innerHTML = votes
    .map((v) => {
      const choice = v.choice || "";
      const choiceClass =
        choice === "찬성" ? "decision--yes" : choice === "반대" ? "decision--no" : "decision--abstain";

      return `
      <div class="vote-card fade-in">
        <div class="vote-card-left">
          <div class="vote-card-meta">
            <span class="vote-card-date">${formatVoteDate(v.voteDate)}</span>
            <span class="vote-card-topic">${v.billNo || ""}</span>
          </div>
          <div class="vote-card-title">${v.title || ""}</div>
        </div>
        <span class="vote-decision-badge ${choiceClass}">${choice}</span>
      </div>`;
    })
    .join("");
}

function renderBills(bills) {
  const header = document.querySelector(".activity-header");
  if (header) {
    header.textContent = getCurrentLanguage() === "ko" ? "최근 발의 법안" : "Recent Bills";
  }

  const wrap = document.getElementById("activity-wrap");
  if (!bills.length) {
    wrap.innerHTML = `<p style="color:rgba(245,245,247,0.3);font-size:15px">${t("member.activity.none")}</p>`;
    return;
  }

  wrap.innerHTML = bills
    .map((b) => {
      const status = b.status || b.billStatus || "";
      const proposalDate = formatProposalDate(b.proposalDate);
      const meta = [status, proposalDate].filter(Boolean).join(" · ");
      return `
        <div class="activity-item fade-in">
          <span class="activity-dot activity-dot--ongoing"></span>
          <span>${b.title || ""}${meta ? ` (${meta})` : ""}</span>
        </div>`;
    })
    .join("");
}

function renderShareCard(rep) {
  const p = rep.profile;
  const s = rep.stats;
  const el = document.getElementById("rep-summary");
  if (!el) return;

  const support = Number(s.supportRate || 0).toFixed(1);
  const oppose = Number(s.opposeRate || 0).toFixed(1);
  const abstain = Number(s.abstainRate || 0).toFixed(1);

  el.innerHTML = `
    <div class="share-card-photo-wrap">
      <img class="share-card-photo" src="${p.photo || ""}" alt="${p.name || ""}" crossorigin="anonymous" referrerpolicy="no-referrer" />
    </div>
    <div class="share-card-body">
      <h3 class="share-card-name">${p.name || ""}</h3>
      <p class="share-card-meta">${escapeHTML(p.district || "")}&nbsp;&nbsp;${partyAccentHTML(p.party || "")}</p>
      <div class="share-card-stats">
        <div class="share-stat-item">
          <span class="share-stat-num">${s.voteParticipationRate || 0}%</span>
          <span class="share-stat-label">${t("member.share.stat.vote")}</span>
        </div>
        <div class="share-stat-item">
          <span class="share-stat-num">${s.billsProposed || 0}</span>
          <span class="share-stat-label">${t("member.share.stat.bills.short")}</span>
        </div>
        <div class="share-stat-item">
          <span class="share-stat-num">${s.absentCount || 0}</span>
          <span class="share-stat-label">${t("member.share.stat.absent")}</span>
        </div>
      </div>
      <p class="share-card-meta share-card-tendency">
        ${t("member.share.tendency")}
        ${t("member.share.choice.support")} ${support}% ·
        ${t("member.share.choice.oppose")} ${oppose}% ·
        ${t("member.share.choice.abstain")} ${abstain}%
      </p>
      <div class="rep-watermark">RepView.app</div>
    </div>`;
}

function initShareActions() {
  const saveBtn = document.getElementById("save-image-btn");
  const shareBtn = document.getElementById("share-btn");
  if (saveBtn && saveBtn.dataset.bound !== "1") {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", async () => {
      const card = document.getElementById("rep-summary");
      if (!card || typeof html2canvas !== "function") return;
      try {
        const canvas = await html2canvas(card, {
          scale: 2,
          backgroundColor: "#050505",
          useCORS: true,
          allowTaint: false,
          imageTimeout: 15000,
          onclone: (clonedDoc) => {
            const clonedWatermark = clonedDoc.querySelector("#rep-summary .rep-watermark");
            if (clonedWatermark) clonedWatermark.style.display = "block";
          },
        });

        const link = document.createElement("a");
        const name = document.querySelector(".share-card-name")?.textContent?.trim() || "representative";
        link.download = `repview_${name}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } catch (err) {
        console.error(err);
        alert("이미지 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  if (shareBtn && shareBtn.dataset.bound !== "1") {
    shareBtn.dataset.bound = "1";
    shareBtn.addEventListener("click", async () => {
      const rep = currentRepresentative || {};
      const profile = rep.profile || {};
      const slug = rep.slug || new URLSearchParams(location.search).get("slug") || "";
      const shareUrl = slug
        ? `${window.location.origin}/member/${encodeURIComponent(slug)}`
        : window.location.href;

      const district = String(profile.district || "").trim();
      const name = String(profile.name || "").trim();
      const headline = `${district} 국회의원 ${name}`;
      const body = "표결 참여율, 발의 법안, 표결 성향을 한눈에 확인하세요.";
      const shareMessage = `${headline}\n\n${body}\n\nRepView\n${shareUrl}`;

      if (navigator.share) {
        try {
          await navigator.share({
            text: shareMessage,
          });
        } catch (err) {
          // user cancelled share sheet
        }
      } else {
        await navigator.clipboard.writeText(shareMessage);
        alert("공유 문구가 복사되었습니다.");
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", initMember);
