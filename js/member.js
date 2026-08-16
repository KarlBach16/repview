// ── Member detail page logic ───────────────────────────────
let currentRepresentative = null;

async function initMember() {
  initI18n();

  const collaborationPromise = loadJSON("data/kr/collaboration_networks.json")
    .catch((error) => {
      console.error("Collaboration data load error:", error);
      return null;
    });
  const voteSimilarityPromise = loadJSON("data/kr/vote_similarity.json")
    .catch((error) => {
      console.error("Vote similarity data load error:", error);
      return null;
    });
  const supporterPromise = loadJSON("data/kr/supporter_associations.json").catch(() => null);
  const booksPromise = loadJSON("data/kr/member_books.json").catch(() => null);

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

  Promise.all([collaborationPromise, voteSimilarityPromise]).then(([collaborationEvidence, similarityEvidence]) => {
    if (currentRepresentative !== rep) return;
    rep.collaborationNetwork = resolveCollaborationNetwork(rep, data.representatives, collaborationEvidence);
    rep.voteSimilarity = resolveVoteSimilarity(rep, data.representatives, similarityEvidence);
    renderRelationshipNetwork(rep, "all");
    initNetworkTabs(rep);
    initFadeIns();
  });
  Promise.all([supporterPromise, booksPromise]).then(([supporters, books]) => {
    if (currentRepresentative !== rep) return;
    renderMemberMore(rep, supporters?.members?.[rep.monaCode], books?.members?.[rep.monaCode]);
  });

  window.addEventListener("repview:languagechange", () => {
    if (!currentRepresentative) return;
    renderMember(currentRepresentative);
    initFadeIns();
  });
}

function nationalLibrarySearchUrl(title, author) {
  const url = new URL("https://www.nl.go.kr/kolisnet/search/searchResultAllList.do");
  url.searchParams.set("keyword1", [title, author].filter(Boolean).join(" "));
  url.searchParams.set("keywordType1", "total");
  url.searchParams.set("tab", "ALL");
  return url.href;
}

function renderMemberMore(rep, supporter, books) {
  const section = document.getElementById("member-more");
  const booksBlock = document.getElementById("member-books-block");
  const bookRail = document.getElementById("member-book-rail");
  const supporterBlock = document.getElementById("member-supporter-block");
  const supporterName = document.getElementById("member-supporter-name");
  const supporterAddress = document.getElementById("member-supporter-address");
  const supporterLinks = document.getElementById("member-supporter-links");
  if (!section || !booksBlock || !bookRail || !supporterBlock || !supporterName || !supporterAddress || !supporterLinks) return;

  const rows = Array.isArray(books) ? books.slice(0, 3) : [];
  booksBlock.hidden = rows.length === 0;
  if (rows.length) {
    bookRail.innerHTML = rows.map((book, index) => `
      <a class="member-book-card member-book-card--${(index % 3) + 1}" href="${escapeHTML(nationalLibrarySearchUrl(book.title, rep.profile?.name))}" target="_blank" rel="noopener noreferrer">
        <span>${escapeHTML(book.year || "")}${book.coauthored ? " · 공저" : ""}</span>
        <strong>${escapeHTML(book.title || "")}</strong>
        <small>${escapeHTML(book.publisher || "국립중앙도서관에서 보기")} ↗</small>
      </a>`).join("");
  }

  const hasSupporter = Boolean(supporter?.associationName && (supporter?.address || supporter?.phone || supporter?.donationUrl));
  supporterBlock.hidden = !hasSupporter;
  if (hasSupporter) {
    supporterName.textContent = supporter.associationName || "";
    supporterAddress.textContent = supporter.address || supporter.region || "";
    supporterLinks.innerHTML = [
      supporter.phone ? `<a href="tel:${escapeHTML(String(supporter.phone).replace(/[^0-9+]/g, ""))}">${escapeHTML(supporter.phone)}</a>` : "",
      supporter.donationUrl ? `<a href="${escapeHTML(supporter.donationUrl)}" target="_blank" rel="noopener noreferrer">공식 후원 페이지 ↗</a>` : "",
      supporter.sourceUrl ? `<a href="${escapeHTML(supporter.sourceUrl)}" target="_blank" rel="noopener noreferrer">후원회 정보 ↗</a>` : "",
    ].filter(Boolean).join("");
  }
  section.hidden = rows.length === 0 && !hasSupporter;
}

function resolveVoteSimilarity(rep, representatives, evidence) {
  const raw = evidence?.members?.[rep?.monaCode];
  if (!raw) return null;
  const representativeByCode = new Map(
    representatives.map((item) => [String(item?.monaCode || ""), item])
  );
  return {
    ...raw,
    topMatches: (raw.topMatches || []).map((match) => {
      const matchedRep = representativeByCode.get(String(match?.monaCode || ""));
      const profile = matchedRep?.profile || {};
      return {
        ...match,
        slug: matchedRep?.slug || "",
        name: profile.name || "",
        party: profile.party || "",
        district: profile.district || "",
        committee: profile.committee || "",
        photo: profile.photo || "",
        representative: matchedRep,
      };
    }).filter((match) => match.name),
  };
}

function initNetworkTabs(rep) {
  const section = document.getElementById("collaboration-section");
  if (!section || section.dataset.tabsReady === "true") return;
  section.dataset.tabsReady = "true";
  section.querySelectorAll("[data-network-view]").forEach((button) => {
    button.addEventListener("click", () => {
      section.querySelectorAll("[data-network-view]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      renderRelationshipNetwork(rep, button.dataset.networkView || "all");
    });
  });
}

const RELATIONSHIP_POSITIONS = [
  [14, 24], [35, 12], [74, 16], [88, 46], [70, 81], [27, 82],
];

function committeeNames(value) {
  return String(value || "")
    .split(/[,·]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sharedPartyBreakCount(left, right) {
  const leftVotes = new Set((left?.partyComparison?.votes || []).map((vote) => String(vote?.billId || "")).filter(Boolean));
  return (right?.partyComparison?.votes || []).filter((vote) => leftVotes.has(String(vote?.billId || ""))).length;
}

function relationshipCandidates(rep) {
  const candidates = new Map();
  const ensure = (key, profile = {}) => {
    if (!key) return null;
    if (!candidates.has(key)) candidates.set(key, { key, ...profile });
    return candidates.get(key);
  };

  for (const collaborator of rep?.collaborationNetwork?.topCollaborators || []) {
    const candidate = ensure(collaborator.monaCode, collaborator);
    if (candidate) candidate.collaboration = collaborator;
  }
  for (const match of rep?.voteSimilarity?.topMatches || []) {
    const candidate = ensure(match.monaCode, match);
    if (candidate) {
      Object.assign(candidate, match);
      candidate.similarity = match;
    }
  }

  const maxBills = Math.max(1, ...[...candidates.values()].map((candidate) => Number(candidate.collaboration?.billCount || 0)));
  const ownCommittees = committeeNames(rep?.profile?.committee);
  for (const candidate of candidates.values()) {
    const billCount = Number(candidate.collaboration?.billCount || 0);
    const agreementRate = Number(candidate.similarity?.agreementRate || 0);
    const commonVoteCount = Number(candidate.similarity?.commonVoteCount || 0);
    const billStrength = billCount ? Math.log1p(billCount) / Math.log1p(maxBills) : 0;
    const voteStrength = agreementRate
      ? Math.max(0, (agreementRate - 50) / 50) * Math.min(commonVoteCount / 50, 1)
      : 0;
    candidate.sharedPartyBreaks = sharedPartyBreakCount(rep, candidate.representative);
    candidate.commonCommittees = ownCommittees.filter((committee) => committeeNames(candidate.committee).includes(committee));
    candidate.billStrength = billStrength;
    candidate.voteStrength = voteStrength;
    candidate.overallStrength = (
      billStrength * 0.46
      + voteStrength * 0.36
      + Math.min(candidate.sharedPartyBreaks / 3, 1) * 0.12
      + (candidate.commonCommittees.length ? 0.06 : 0)
    );
  }
  return [...candidates.values()];
}

function selectRelationshipCandidates(rep, view) {
  const candidates = relationshipCandidates(rep);
  const strengthFor = (candidate) => view === "collaboration"
    ? candidate.billStrength
    : view === "similarity"
      ? candidate.voteStrength
      : candidate.overallStrength;
  const filtered = candidates
    .filter((candidate) => view === "collaboration" ? candidate.collaboration : view === "similarity" ? candidate.similarity : true)
    .sort((a, b) => strengthFor(b) - strengthFor(a) || String(a.name || "").localeCompare(String(b.name || ""), "ko"));
  const selected = filtered.slice(0, 6);
  if (view === "all") {
    const otherParty = filtered.find((candidate) => candidate.sameParty === false);
    if (otherParty && !selected.includes(otherParty) && selected.length) selected[selected.length - 1] = otherParty;
  }
  return selected.map((candidate) => ({ ...candidate, strength: strengthFor(candidate) }));
}

function renderRelationshipDetail(rep, relation) {
  const detail = document.getElementById("relationship-detail");
  if (!detail || !relation) return;
  const profileRoute = relation.slug
    ? `member.html?slug=${encodeURIComponent(relation.slug)}`
    : `member.html?id=${encodeURIComponent(relation.monaCode || "")}`;
  const metrics = [];
  if (relation.collaboration) {
    const directed = [
      relation.collaboration.ledByMemberCount ? `내 법안 ${relation.collaboration.ledByMemberCount}` : "",
      relation.collaboration.ledByCollaboratorCount ? `상대 법안 ${relation.collaboration.ledByCollaboratorCount}` : "",
    ].filter(Boolean).join(" · ");
    metrics.push(`<div><strong>${relation.collaboration.billCount || 0}건</strong><span>공동발의${directed ? `<small>${directed}</small>` : ""}</span></div>`);
  }
  if (relation.similarity) metrics.push(`<div><strong>${Number(relation.similarity.agreementRate || 0).toFixed(1)}%</strong><span>표결 일치<small>공통 ${relation.similarity.commonVoteCount || 0}건</small></span></div>`);
  if (relation.sharedPartyBreaks) metrics.push(`<div><strong>${relation.sharedPartyBreaks}건</strong><span>함께 당내 이탈</span></div>`);
  if (relation.commonCommittees.length) metrics.push(`<div><strong>${relation.commonCommittees.length}</strong><span>공통 위원회<small>${escapeHTML(relation.commonCommittees.join(" · "))}</small></span></div>`);
  detail.innerHTML = `
    <div class="relationship-detail-title">
      <span>${escapeHTML(rep.profile?.name || "")} × ${escapeHTML(relation.name || "")}</span>
      <a href="${escapeHTML(profileRoute)}">${escapeHTML(relation.name || "")} 의원 보기 →</a>
    </div>
    <div class="relationship-metrics">${metrics.join("")}</div>`;
}

function renderRelationshipNetwork(rep, view = "all") {
  const section = document.getElementById("collaboration-section");
  const stage = document.getElementById("relationship-stage");
  const stats = document.getElementById("collaboration-stats");
  const eyebrow = document.getElementById("network-eyebrow");
  const headline = document.getElementById("network-headline");
  if (!section || !stage || !stats) return;
  const relations = selectRelationshipCandidates(rep, view);
  if (!relations.length) { section.hidden = true; return; }
  const labels = {
    all: ["제22대 국회 · 정치 행동 연결망", "함께 움직인 의원."],
    collaboration: ["제22대 국회 · 공동발의", "자주 함께한 의원."],
    similarity: ["제22대 국회 · 표결 선택", "표결이 비슷한 의원."],
  };
  if (eyebrow) eyebrow.textContent = labels[view]?.[0] || labels.all[0];
  if (headline) headline.textContent = labels[view]?.[1] || labels.all[1];
  stats.innerHTML = `<span><strong>${relations.length}</strong> 연결 의원</span>`;
  const centerPhoto = rep.profile?.photo || "";
  const lineClass = view === "collaboration" ? "is-collaboration" : view === "similarity" ? "is-similarity" : "is-combined";
  stage.innerHTML = `
    <svg class="relationship-bonds" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="relationship-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0071e3"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
      ${relations.map((relation, index) => {
        const [x, y] = RELATIONSHIP_POSITIONS[index];
        return `<line class="relationship-bond ${lineClass}" x1="50" y1="50" x2="${x}" y2="${y}" style="--bond-width:${(1.1 + Math.max(0.15, relation.strength) * 2.8).toFixed(2)}"/>`;
      }).join("")}
    </svg>
    <div class="relationship-center">
      <span class="relationship-center-photo${centerPhoto ? "" : " is-missing"}">${centerPhoto ? `<img src="${escapeHTML(centerPhoto)}" alt="${escapeHTML(rep.profile?.name || "")}" />` : escapeHTML(String(rep.profile?.name || "?").slice(0, 1))}</span>
      <strong>${escapeHTML(rep.profile?.name || "")}</strong>
    </div>
    ${relations.map((relation, index) => {
      const [x, y] = RELATIONSHIP_POSITIONS[index];
      const nodeSize = Math.round(54 + Math.max(0.15, relation.strength) * 18);
      return `<button class="relationship-node${index === 0 ? " is-selected" : ""}" type="button" data-relation-index="${index}" style="--node-x:${x}%;--node-y:${y}%;--node-size:${nodeSize}px" aria-label="${escapeHTML(relation.name || "")}">
        <span class="relationship-node-photo${relation.photo ? "" : " is-missing"}">${relation.photo ? `<img src="${escapeHTML(relation.photo)}" alt="" loading="lazy" />` : `<i>${escapeHTML(String(relation.name || "?").slice(0, 1))}</i>`}</span>
        <strong>${escapeHTML(relation.name || "")}</strong>
      </button>`;
    }).join("")}`;
  stage.querySelectorAll("[data-relation-index]").forEach((button) => {
    button.addEventListener("click", () => {
      stage.querySelectorAll(".relationship-node").forEach((node) => node.classList.toggle("is-selected", node === button));
      renderRelationshipDetail(rep, relations[Number(button.dataset.relationIndex)]);
    });
  });
  renderRelationshipDetail(rep, relations[0]);
  section.hidden = false;
}

function resolveCollaborationNetwork(rep, representatives, evidence) {
  const raw = evidence?.members?.[rep?.monaCode];
  if (!raw) return null;
  const representativeByCode = new Map(
    representatives.map((item) => [String(item?.monaCode || ""), item])
  );

  return {
    ...raw,
    topCollaborators: (raw.topCollaborators || []).map((collaborator) => {
      const collaboratorRep = representativeByCode.get(String(collaborator?.monaCode || ""));
      const profile = collaboratorRep?.profile || {};
      return {
        ...collaborator,
        slug: collaboratorRep?.slug || "",
        name: profile.name || "",
        party: profile.party || "",
        district: profile.district || "",
        committee: profile.committee || "",
        photo: profile.photo || "",
        representative: collaboratorRep,
        sharedBills: (collaborator.sharedBillIds || []).map((billId) => ({
          billId,
          ...(evidence?.bills?.[billId] || {}),
        })),
      };
    }).filter((collaborator) => collaborator.name),
  };
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

function assemblyBillDetailUrl(billId, detailLink = "") {
  const explicit = String(detailLink || "").trim();
  if (/^https?:\/\//i.test(explicit)) return explicit;
  const id = String(billId || "").trim();
  if (!/^[a-z0-9_]+$/i.test(id)) return "";
  return `http://likms.assembly.go.kr/bill/billDetail.do?billId=${encodeURIComponent(id)}&ageFrom=22&ageTo=22`;
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
    ? `비교 가능한 표결 ${comparison.eligibleVoteCount || 0}건 중 ${count}번입니다. 최근 90일에는 ${comparison.last90DaysCount || 0}번 있었습니다. ${comparison.basisLabel || ""}`
    : "정당별 비교 자료가 없습니다.";

  const votes = Array.isArray(comparison?.votes) ? comparison.votes.slice(0, 5) : [];
  if (!votes.length) {
    listEl.innerHTML = `<p class="insight-empty">현재 기준에서 당내 다수와 다른 찬반 표결이 없습니다.</p>`;
    return;
  }

  listEl.innerHTML = votes
    .map((v) => {
      const billUrl = assemblyBillDetailUrl(v.billId);
      return `
      <article class="insight-card fade-in">
        <div class="insight-card-topline">
          <span>${formatVoteDate(v.voteDate)}</span>
          <span class="vote-decision-badge ${choiceClass(v.choice)}">${escapeHTML(v.choice)}</span>
        </div>
        <h3>${billUrl
          ? `<a class="bill-title-link" href="${escapeHTML(billUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(v.title || "")}</a>`
          : escapeHTML(v.title || "")}</h3>
        <p>당내 다수 선택은 ${escapeHTML(v.partyMajorityChoice || "")}였습니다.</p>
        ${distributionHTML(v.partyDistribution, "같은 정당")}
        ${distributionHTML(v.assemblyDistribution, "전체 국회")}
      </article>`;
    })
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
  listEl.innerHTML = bills.map((bill) => {
    const billUrl = assemblyBillDetailUrl(bill.billId, bill.detailLink);
    return `
    <a class="lifecycle-item fade-in" href="${escapeHTML(billUrl || "#")}" ${billUrl ? 'target="_blank" rel="noopener noreferrer"' : ""}>
      <div>
        <span class="lifecycle-date">${formatProposalDate(bill.proposalDate)}</span>
        <h3>${escapeHTML(bill.title || "")}</h3>
      </div>
      <span class="lifecycle-status lifecycle-status--${escapeHTML(bill.statusCategory || "in_progress")}">${escapeHTML(bill.status || "심사 중")}</span>
    </a>`;
  }).join("");
}

function renderCollaborationNetwork(rep) {
  const sectionEl = document.getElementById("collaboration-section");
  const statsEl = document.getElementById("collaboration-stats");
  const originEl = document.getElementById("collaboration-origin");
  const listEl = document.getElementById("collaboration-list");
  const eyebrowEl = document.getElementById("network-eyebrow");
  const headlineEl = document.getElementById("network-headline");
  if (!sectionEl || !statsEl || !originEl || !listEl) return;

  const network = rep.collaborationNetwork || {};
  const collaborators = Array.isArray(network.topCollaborators)
    ? network.topCollaborators.slice(0, 5)
    : [];
  sectionEl.hidden = collaborators.length === 0;
  if (!collaborators.length) return;
  if (eyebrowEl) eyebrowEl.textContent = "제22대 국회 · 공동발의 명단";
  if (headlineEl) headlineEl.textContent = "자주 함께한 의원.";

  const profile = rep.profile || {};
  originEl.innerHTML = `
    <div class="collaboration-origin-photo${profile.photo ? "" : " is-missing"}">
      ${profile.photo
        ? `<img src="${escapeHTML(profile.photo)}" alt="${escapeHTML(profile.name || "")}" />`
        : `<span>${escapeHTML(String(profile.name || "?").slice(0, 1))}</span>`}
    </div>
    <strong>${escapeHTML(profile.name || "")}</strong>`;

  statsEl.innerHTML = `
    <span><strong>${network.collaborationBillCount || 0}</strong> 함께한 법안</span>
    <span><strong>${network.uniqueCollaboratorCount || 0}</strong> 함께한 의원</span>
    <span><strong>${network.otherPartyCollaboratorCount || 0}</strong> 다른 정당 의원</span>`;

  listEl.innerHTML = collaborators.map((collaborator, index) => {
    const sharedBills = Array.isArray(collaborator.sharedBills) ? collaborator.sharedBills : [];
    const profileRoute = collaborator.slug
      ? `member.html?slug=${encodeURIComponent(collaborator.slug)}`
      : `member.html?id=${encodeURIComponent(collaborator.monaCode || "")}`;
    return `
      <details class="collaboration-person"${index === 0 ? " open" : ""}>
        <summary>
          <span class="collaboration-person-photo${collaborator.photo ? "" : " is-missing"}">
            ${collaborator.photo
              ? `<img src="${escapeHTML(collaborator.photo)}" alt="${escapeHTML(collaborator.name || "")}" loading="lazy" />`
              : `<i>${escapeHTML(String(collaborator.name || "?").slice(0, 1))}</i>`}
          </span>
          <span class="collaboration-person-copy">
            <strong>${escapeHTML(collaborator.name || "")}</strong>
            <small>${partyAccentHTML(collaborator.party || "")}</small>
          </span>
          <span class="collaboration-line" aria-hidden="true"></span>
          <span class="collaboration-count"><strong>${collaborator.billCount || 0}</strong>건</span>
        </summary>
        <div class="collaboration-bills">
          ${sharedBills.map((bill) => {
            const billUrl = assemblyBillDetailUrl(bill.billId, bill.detailLink);
            return `
            <a href="${escapeHTML(billUrl || "#")}" ${billUrl ? 'target="_blank" rel="noopener noreferrer"' : ""}>
              <span>${escapeHTML(formatProposalDate(bill.proposalDate))}</span>
              <strong>${escapeHTML(bill.title || "")}</strong>
            </a>`;
          }).join("")}
          <a class="collaboration-profile-link" href="${escapeHTML(profileRoute)}">${escapeHTML(collaborator.name || "")} 의원 보기 →</a>
        </div>
      </details>`;
  }).join("");

  listEl.querySelectorAll(".collaboration-person").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      listEl.querySelectorAll(".collaboration-person[open]").forEach((other) => {
        if (other !== details) other.removeAttribute("open");
      });
    });
  });
}

function renderVoteSimilarityNetwork(rep) {
  const sectionEl = document.getElementById("collaboration-section");
  const statsEl = document.getElementById("collaboration-stats");
  const originEl = document.getElementById("collaboration-origin");
  const listEl = document.getElementById("collaboration-list");
  const eyebrowEl = document.getElementById("network-eyebrow");
  const headlineEl = document.getElementById("network-headline");
  if (!sectionEl || !statsEl || !originEl || !listEl) return;
  const similarity = rep.voteSimilarity || {};
  const matches = Array.isArray(similarity.topMatches) ? similarity.topMatches.slice(0, 5) : [];
  if (!matches.length) return;

  if (eyebrowEl) eyebrowEl.textContent = "제22대 국회 · 표결 선택";
  if (headlineEl) headlineEl.textContent = "표결이 비슷한 의원.";
  const profile = rep.profile || {};
  originEl.innerHTML = `
    <div class="collaboration-origin-photo${profile.photo ? "" : " is-missing"}">
      ${profile.photo
        ? `<img src="${escapeHTML(profile.photo)}" alt="${escapeHTML(profile.name || "")}" />`
        : `<span>${escapeHTML(String(profile.name || "?").slice(0, 1))}</span>`}
    </div>
    <strong>${escapeHTML(profile.name || "")}</strong>`;
  statsEl.innerHTML = `<span><strong>${similarity.eligibleVoteCount || 0}</strong> 비교 표결</span>`;
  listEl.innerHTML = matches.map((match) => {
    const profileRoute = match.slug
      ? `member.html?slug=${encodeURIComponent(match.slug)}`
      : `member.html?id=${encodeURIComponent(match.monaCode || "")}`;
    return `
      <a class="collaboration-person similarity-person" href="${escapeHTML(profileRoute)}">
        <span class="collaboration-person-photo${match.photo ? "" : " is-missing"}">
          ${match.photo
            ? `<img src="${escapeHTML(match.photo)}" alt="${escapeHTML(match.name || "")}" loading="lazy" />`
            : `<i>${escapeHTML(String(match.name || "?").slice(0, 1))}</i>`}
        </span>
        <span class="collaboration-person-copy">
          <strong>${escapeHTML(match.name || "")}</strong>
          <small>${partyAccentHTML(match.party || "")} · 공통 ${match.commonVoteCount || 0}건</small>
        </span>
        <span class="collaboration-line" aria-hidden="true"></span>
        <span class="collaboration-count"><strong>${Number(match.agreementRate || 0).toFixed(1)}%</strong></span>
      </a>`;
  }).join("");
  sectionEl.hidden = false;
}

function renderParticipationContext(context) {
  const rateEl = document.getElementById("participation-90-rate");
  const summaryEl = document.getElementById("participation-summary");
  const comparisonEl = document.getElementById("participation-comparison");
  const runsEl = document.getElementById("absence-run-list");
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
      const billUrl = assemblyBillDetailUrl(v.billId);
      return `
      <div class="vote-card">
        <div class="vote-card-left">
          <div class="vote-card-meta">
            <span class="vote-card-date">${formatVoteDate(v.voteDate)}</span>
            <span class="vote-card-topic">${v.billNo || ""}</span>
          </div>
          <div class="vote-card-title">${billUrl
            ? `<a class="bill-title-link" href="${escapeHTML(billUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(v.title || "")}</a>`
            : escapeHTML(v.title || "")}</div>
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
