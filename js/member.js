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
  trackMemberView(rep.slug || rep.monaCode || "");

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

  document.title = `${p.name} — RepView`;

  const heroPhoto = document.getElementById("hero-photo");
  const heroInitials = document.getElementById("hero-initials");
  const heroMedia = heroPhoto?.closest(".member-poster-media");
  heroPhoto.src = p.photo || "";
  heroPhoto.alt = p.name || "";
  if (heroInitials) heroInitials.textContent = p.name || "";
  if (heroMedia) {
    heroMedia.classList.toggle("is-missing", !p.photo);
    heroPhoto.onload = () => heroMedia.classList.remove("is-missing");
    heroPhoto.onerror = () => heroMedia.classList.add("is-missing");
  }

  document.getElementById("hero-committee").textContent = primaryCommittee(p.committee || "");
  document.getElementById("hero-name").textContent = p.name || "";
  document.getElementById("hero-meta").innerHTML = `
    ${escapeHTML(p.district || "")}&nbsp;&nbsp;${partyAccentHTML(p.party || "")}
  `;
  const executiveRoleEl = document.getElementById("hero-executive-role");
  if (executiveRoleEl) {
    const role = rep.executiveRole;
    executiveRoleEl.hidden = !role?.active;
    if (role?.active) {
      executiveRoleEl.href = role.sourceUrl || "#";
      executiveRoleEl.textContent = `${role.title} 겸직 · ${role.verifiedAt} 확인`;
    }
  }

  renderPartyComparison(rep.partyComparison);
  renderBillLifecycle(rep.billLifecycle);
  renderParticipationContext(rep.participationContext);
  renderVotes(rep.recentVotes || []);
  renderShareCard(rep);
}

function choiceClass(choice) {
  if (choice === "찬성") return "decision--yes";
  if (choice === "반대") return "decision--no";
  return "decision--abstain";
}

function distributionHTML(distribution, prefix) {
  const d = distribution || {};
  const total = Number(d.support || 0) + Number(d.oppose || 0) + Number(d.abstain || 0) + Number(d.absent || 0);
  const support = total ? (Number(d.support || 0) / total) * 100 : 0;
  const oppose = total ? (Number(d.oppose || 0) / total) * 100 : 0;
  const rest = Math.max(100 - support - oppose, 0);
  return `
    <div class="distribution-row">
      <div class="distribution-label">${escapeHTML(prefix)}</div>
      <div class="distribution-track" aria-label="${escapeHTML(prefix)} 찬성 ${d.support || 0}, 반대 ${d.oppose || 0}, 기타 ${Number(d.abstain || 0) + Number(d.absent || 0)}">
        <span class="distribution-support" style="width:${support}%"></span>
        <span class="distribution-oppose" style="width:${oppose}%"></span>
        <span class="distribution-rest" style="width:${rest}%"></span>
      </div>
      <div class="distribution-values">찬성 ${d.support || 0} · 반대 ${d.oppose || 0}</div>
    </div>`;
}

function renderPartyComparison(comparison) {
  const countEl = document.getElementById("party-difference-count");
  const summaryEl = document.getElementById("party-comparison-summary");
  const listEl = document.getElementById("party-difference-list");
  if (!countEl || !summaryEl || !listEl) return;

  const count = Number(comparison?.differentFromPartyMajorityCount || 0);
  countEl.dataset.count = String(count);
  summaryEl.textContent = comparison
    ? `비교 가능한 표결 ${comparison.eligibleVoteCount || 0}건 중 최근 90일 ${comparison.last90DaysCount || 0}건입니다. ${comparison.basisLabel || ""}`
    : "정당별 비교 자료가 없습니다.";

  const votes = Array.isArray(comparison?.votes) ? comparison.votes.slice(0, 5) : [];
  if (!votes.length) {
    listEl.innerHTML = `<p class="insight-empty">현재 기준에서 당내 다수와 다른 찬반 표결이 없습니다.</p>`;
    return;
  }

  listEl.innerHTML = votes
    .map((v) => `
      <article class="insight-card fade-in">
        <div class="insight-card-topline">
          <span>${formatVoteDate(v.voteDate)}</span>
          <span class="vote-decision-badge ${choiceClass(v.choice)}">${escapeHTML(v.choice)}</span>
        </div>
        <h3>${escapeHTML(v.title || "")}</h3>
        <p>당내 다수 선택은 ${escapeHTML(v.partyMajorityChoice || "")}였습니다.</p>
        ${distributionHTML(v.partyDistribution, "같은 정당")}
        ${distributionHTML(v.assemblyDistribution, "전체 국회")}
      </article>`)
    .join("");
}

function renderBillLifecycle(lifecycle) {
  const totalEl = document.getElementById("bill-total-count");
  const summaryEl = document.getElementById("bill-lifecycle-summary");
  const metricsEl = document.getElementById("bill-metrics");
  const listEl = document.getElementById("bill-lifecycle-list");
  if (!totalEl || !summaryEl || !metricsEl || !listEl) return;

  const total = Number(lifecycle?.leadSponsoredTotal || 0);
  const mature = lifecycle?.olderThan180Days || {};
  totalEl.dataset.count = String(total);
  summaryEl.textContent = Number.isFinite(mature.completionRate)
    ? `발의 후 ${lifecycle.matureAfterDays}일이 지난 ${mature.total}건 중 ${mature.completed}건이 처리를 마쳤습니다.`
    : "기간 보정 처리율을 계산할 수 있는 법안이 아직 없습니다.";
  metricsEl.innerHTML = `
    <div><strong>${lifecycle?.inProgress || 0}</strong><span>심사 중</span></div>
    <div><strong>${lifecycle?.completed || 0}</strong><span>처리 완료</span></div>
    <div><strong>${lifecycle?.crossPartyCount || 0}</strong><span>타 정당 의원과 공동발의</span></div>`;

  const bills = Array.isArray(lifecycle?.recentBills) ? lifecycle.recentBills.slice(0, 6) : [];
  listEl.innerHTML = bills.map((bill) => `
    <a class="lifecycle-item fade-in" href="${escapeHTML(bill.detailLink || "#")}" ${bill.detailLink ? 'target="_blank" rel="noopener noreferrer"' : ""}>
      <div>
        <span class="lifecycle-date">${formatProposalDate(bill.proposalDate)}</span>
        <h3>${escapeHTML(bill.title || "")}</h3>
      </div>
      <span class="lifecycle-status lifecycle-status--${escapeHTML(bill.statusCategory || "in_progress")}">${escapeHTML(bill.status || "심사 중")}</span>
    </a>`).join("");
}

function renderParticipationContext(context) {
  const rateEl = document.getElementById("participation-90-rate");
  const summaryEl = document.getElementById("participation-summary");
  const comparisonEl = document.getElementById("participation-comparison");
  const runsEl = document.getElementById("absence-run-list");
  const updatedEl = document.getElementById("data-updated");
  if (!rateEl || !summaryEl || !comparisonEl || !runsEl) return;

  const period = context?.last90Days || {};
  const term = context?.term || {};
  const rate = Number.isFinite(period.rate) ? period.rate : 0;
  const partyMedian = context?.partyMedian?.last90Days;
  const allMedian = context?.allMemberMedian?.last90Days;
  if (period.total) {
    rateEl.dataset.count = String(rate);
    rateEl.dataset.suffix = "%";
  } else {
    rateEl.removeAttribute("data-count");
    rateEl.textContent = "자료 없음";
  }

  const sampleCaution = period.total > 0 && period.total < 20
    ? " 최근 표결이 20건 미만이라 단기 변화 해석에 주의가 필요합니다."
    : "";
  const termSummary = term.total
    ? ` 제22대 국회 전체로는 ${term.total}건 중 ${term.participated}건에 참여했습니다.`
    : "";
  summaryEl.textContent = period.total
    ? `${period.total}건 중 ${period.participated}건에 참여하고 ${period.absent}건에 불참했습니다.${termSummary}${sampleCaution}`
    : "최근 90일 표결 자료가 없어 제22대 국회 전체 기록을 함께 확인해 주세요.";

  const maxScale = 100;
  comparisonEl.innerHTML = [
    ["최근 90일", period.rate],
    ["제22대 국회 전체", term.rate],
    ["정당 중앙값 · 90일", partyMedian],
    ["전체 중앙값 · 90일", allMedian],
  ].map(([label, value]) => `
    <div class="comparison-row">
      <span>${label}</span>
      <div><i style="width:${Math.min(Number(value || 0), maxScale)}%"></i></div>
      <strong>${Number.isFinite(value) ? `${value}%` : "자료 없음"}</strong>
    </div>`).join("");

  const runs = Array.isArray(context?.absenceRuns)
    ? context.absenceRuns.filter((run) => run.count >= 2).slice(0, 5)
    : [];
  runsEl.innerHTML = runs.length
    ? `<p class="absence-run-heading">최근 연속 불참 기록</p>` + runs.map((run) => `
      <div class="absence-run fade-in">
        <div><strong>${escapeHTML(run.date)}</strong><span>${run.count}건 연속</span></div>
        <p>${run.surroundedByParticipation ? "같은 날 직전과 직후 표결에는 참여했습니다." : "같은 날짜에 연속으로 기록된 불참입니다."}</p>
      </div>`).join("")
    : `<p class="insight-empty">두 건 이상 이어진 최근 불참 기록이 없습니다.</p>`;
  if (updatedEl) updatedEl.textContent = `표결 데이터 기준일 ${context?.dataThrough || "확인되지 않음"}`;
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
      return `
      <div class="vote-card">
        <div class="vote-card-left">
          <div class="vote-card-meta">
            <span class="vote-card-date">${formatVoteDate(v.voteDate)}</span>
            <span class="vote-card-topic">${v.billNo || ""}</span>
          </div>
          <div class="vote-card-title">${escapeHTML(v.title || "")}</div>
        </div>
        <span class="vote-decision-badge ${choiceClass(choice)}">${escapeHTML(choice)}</span>
      </div>`;
    })
    .join("");
}

function renderShareCard(rep) {
  const p = rep.profile;
  const s = rep.stats;
  const el = document.getElementById("rep-summary");
  if (!el) return;

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
          <span class="share-stat-num">${s.absentCount || 0}</span>
          <span class="share-stat-label">${t("member.share.stat.absent")}</span>
        </div>
        <div class="share-stat-item">
          <span class="share-stat-num">${s.billsProposed || 0}</span>
          <span class="share-stat-label">${t("member.share.stat.bills.short")}</span>
        </div>
      </div>
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
        ? `${window.location.origin}/kr/member.html?slug=${encodeURIComponent(slug)}`
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
