import { trackUSMemberView } from "./us-ranking.js";

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

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(1)}%`;
}

function formatInt(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value))}`;
}

function formatUSD(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.0+$|0+$/g, "").replace(/\.$/, "")}M`;
  if (abs >= 1_000) return `$${(amount / 1_000).toFixed(abs >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch (_) {
    return "";
  }
}

function inferVoteKind(vote) {
  if (vote?.voteKindLabel) return vote.voteKindLabel;
  const text = `${vote?.question || ""} ${vote?.subject || ""}`.toLowerCase();
  if (text.includes("motion to recommit")) return "Motion to recommit";
  if (text.includes("h.amdt.") || text.includes("on the amendment")) return "Amendment";
  return "Final passage";
}

function resultClass(result) {
  const normalized = String(result || "").toLowerCase();
  return normalized.includes("pass") || normalized.includes("agree")
    ? "vote-card-result--passed"
    : "vote-card-result--failed";
}

function statNumAttrs(value, suffix) {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return "";
  return `data-count="${n}" data-suffix="${suffix}"`;
}

function animateCount(el, target, suffix, decimals = 0) {
  const duration = 1400;
  const start = performance.now();
  function step(now) {
    const elapsed = Math.min(now - start, duration);
    const eased = 1 - Math.pow(1 - elapsed / duration, 3);
    const current = (target * eased).toFixed(decimals);
    el.textContent = current + suffix;
    if (elapsed < duration) requestAnimationFrame(step);
    else el.textContent = target.toFixed(decimals) + suffix;
  }
  requestAnimationFrame(step);
}

function initCounters(root) {
  const els = (root || document).querySelectorAll("[data-count]");
  if (!els.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        const target = parseFloat(e.target.dataset.count);
        const suffix = e.target.dataset.suffix || "";
        const decimals = String(e.target.dataset.count).includes(".") ? 1 : 0;
        animateCount(e.target, target, suffix, decimals);
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.5 });
  els.forEach((el) => observer.observe(el));
}

function formatVoteDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function formatProposalDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function choiceClass(choice) {
  if (choice === "Yes" || choice === "찬성") return "decision--yes";
  if (choice === "No" || choice === "반대") return "decision--no";
  return "decision--abstain";
}

async function loadUSMembers() {
  const res = await fetch("/data/us/house_members.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load US members: ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

let collaborationEvidencePromise = null;
let voteSimilarityEvidencePromise = null;

async function loadUSCollaborationEvidence() {
  if (!collaborationEvidencePromise) {
    collaborationEvidencePromise = fetch("/data/us/collaboration_networks.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load collaboration evidence: ${response.status}`);
        return response.json();
      });
  }
  return collaborationEvidencePromise;
}

async function loadUSVoteSimilarityEvidence() {
  if (!voteSimilarityEvidencePromise) {
    voteSimilarityEvidencePromise = fetch("/data/us/vote_similarity.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load vote similarity evidence: ${response.status}`);
        return response.json();
      });
  }
  return voteSimilarityEvidencePromise;
}

let voteEvidencePromise = null;

async function loadUSVoteEvidenceData() {
  if (!voteEvidencePromise) {
    voteEvidencePromise = fetch("/data/us/vote_evidence.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load vote evidence: ${response.status}`);
        return response.json();
      });
  }
  return voteEvidencePromise;
}

async function loadMemberVoteEvidence(bioguideId) {
  const data = await loadUSVoteEvidenceData();
  const refs = data?.members?.[String(bioguideId || "").trim().toUpperCase()] || {};

  function resolve(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((ref) => {
      const vote = data?.votes?.[ref?.voteKey];
      return vote ? { ...vote, choice: ref.choice } : null;
    }).filter(Boolean);
  }

  return {
    final: resolve(refs.final),
    preliminary: resolve(refs.preliminary),
    partyBreaks: resolve(refs.partyBreaks),
  };
}

function renderFallback(message) {
  const root = document.getElementById("us-member-root");
  if (!root) return;
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:80px 24px;text-align:center">
      <div>
        <p style="font-size:17px;color:rgba(245,245,247,0.82);margin-bottom:10px">${escapeHTML(message)}</p>
        <a href="./index.html" style="font-size:14px;color:#2997ff">← Back to search</a>
      </div>
    </div>
  `;
}

function renderVotes(votes, limit = 10, emptyMessage = "No recent vote records.") {
  if (!Array.isArray(votes) || !votes.length) {
    return `<p style="color:rgba(245,245,247,0.3);font-size:15px;padding:20px 0">${escapeHTML(emptyMessage)}</p>`;
  }

  return votes.slice(0, limit).map((v) => {
    const kindLabel = inferVoteKind(v);
    const isFinal = v.isFinalPassage === true || v.voteKind === "passage" || kindLabel === "Final passage";
    const subject = isFinal ? (v.title || v.subject) : (v.subject || v.question || v.title);
    const billUrl = safeExternalUrl(v.billUrl);
    const voteUrl = safeExternalUrl(v.voteUrl);
    const subjectHTML = isFinal && billUrl
      ? `<a class="bill-title-link" href="${escapeHTML(billUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(subject || "")}</a>`
      : escapeHTML(subject || "");
    return `
    <article class="vote-card fade-in ${isFinal ? "vote-card--final" : "vote-card--preliminary"}">
      <div class="vote-card-left">
        <div class="vote-card-meta">
          <span class="vote-card-date">${escapeHTML(formatVoteDate(v.voteDate))}</span>
          <span class="vote-kind ${isFinal ? "vote-kind--final" : "vote-kind--preliminary"}">${escapeHTML(kindLabel)}</span>
          ${v.result ? `<span class="vote-card-result ${resultClass(v.result)}">${escapeHTML(v.result)}</span>` : ""}
          <span class="vote-card-topic">${escapeHTML(v.billNo || "")}</span>
          <span class="vote-card-topic">${escapeHTML(v.voteLabel || "")}</span>
        </div>
        <div class="vote-card-title">${subjectHTML}</div>
        ${!isFinal && v.title ? `<div class="vote-parent-bill">Bill: ${billUrl
          ? `<a class="bill-title-link" href="${escapeHTML(billUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(v.title)}</a>`
          : escapeHTML(v.title)}</div>` : ""}
        ${(billUrl || voteUrl) ? `
          <div class="vote-card-links">
            ${billUrl ? `<a href="${escapeHTML(billUrl)}" target="_blank" rel="noopener noreferrer">Read bill ↗</a>` : ""}
            ${voteUrl ? `<a href="${escapeHTML(voteUrl)}" target="_blank" rel="noopener noreferrer">Official roll call ↗</a>` : ""}
          </div>
        ` : ""}
      </div>
      <span class="vote-decision-badge ${choiceClass(v.choice)}">${escapeHTML(v.choice || "-")}</span>
    </article>
  `;
  }).join("");
}

function formatDataDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function renderDataAsOf(member) {
  const dates = member.dataAsOf || {};
  return `
    <section class="us-data-dates">
      <div class="us-data-dates-inner">
        <span>Data dates</span>
        <p>
          House votes through ${escapeHTML(formatDataDate(dates.houseVotes))}
          <i>·</i> Sponsored bills through ${escapeHTML(formatDataDate(dates.sponsoredBills))}
          <i>·</i> Campaign finance through ${escapeHTML(formatDataDate(dates.campaignFinance))}
        </p>
      </div>
    </section>`;
}

function renderBills(bills) {
  if (!Array.isArray(bills) || !bills.length) {
    return `<p style="color:rgba(245,245,247,0.3);font-size:15px">No recent sponsored bills.</p>`;
  }

  return bills.slice(0, 10).map((b) => {
    const meta = [b.status, formatProposalDate(b.proposalDate)].filter(Boolean).join(" · ");
    const billUrl = safeExternalUrl(b.billUrl);
    return `
      <div class="activity-item fade-in">
        <span class="activity-dot activity-dot--ongoing"></span>
        <span>
          ${billUrl
            ? `<a class="activity-link" href="${escapeHTML(billUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(b.title || b.billNo || "")}</a>`
            : escapeHTML(b.title || b.billNo || "")}
          ${meta ? `<span class="activity-meta">${escapeHTML(meta)}</span>` : ""}
        </span>
      </div>
    `;
  }).join("");
}

function renderUSCollaborationNetwork(member, members, evidence) {
  const section = document.getElementById("us-collaboration-section");
  const stats = document.getElementById("us-collaboration-stats");
  const origin = document.getElementById("us-collaboration-origin");
  const list = document.getElementById("us-collaboration-list");
  const eyebrow = document.getElementById("us-network-eyebrow");
  const headline = document.getElementById("us-network-headline");
  if (!section || !stats || !origin || !list) return;

  const bioguideId = String(member.bioguideId || "").trim().toUpperCase();
  const network = evidence?.members?.[bioguideId];
  const memberIndex = new Map(members.map((row) => [String(row.bioguideId || "").trim().toUpperCase(), row]));
  const collaborators = Array.isArray(network?.topCollaborators)
    ? network.topCollaborators.map((row) => ({ ...row, member: memberIndex.get(row.bioguideId) })).filter((row) => row.member)
    : [];
  if (!collaborators.length) return;
  if (eyebrow) eyebrow.textContent = "119th Congress · Cosponsorship";
  if (headline) headline.textContent = "Frequent collaborators.";

  const photo = safeExternalUrl(member.photo);
  origin.innerHTML = `
    <div class="collaboration-origin-photo${photo ? "" : " is-missing"}">
      ${photo
        ? `<img src="${escapeHTML(photo)}" alt="${escapeHTML(member.name || "")}" />`
        : `<span>${escapeHTML(String(member.name || "?").slice(0, 1))}</span>`}
    </div>
    <strong>${escapeHTML(member.name || "")}</strong>`;

  stats.innerHTML = `
    <span><strong>${network.collaborationBillCount || 0}</strong> shared bills</span>
    <span><strong>${network.uniqueCollaboratorCount || 0}</strong> collaborators</span>
    <span><strong>${network.otherPartyCollaboratorCount || 0}</strong> across parties</span>`;

  list.innerHTML = collaborators.map((collaborator, index) => {
    const other = collaborator.member;
    const otherPhoto = safeExternalUrl(other.photo);
    const sharedBills = (collaborator.sharedBillIds || [])
      .map((billId) => evidence?.bills?.[billId])
      .filter(Boolean);
    const profileUrl = `member.html?district=${encodeURIComponent(other.districtCode || "")}`;
    return `
      <details class="collaboration-person"${index === 0 ? " open" : ""}>
        <summary>
          <span class="collaboration-person-photo${otherPhoto ? "" : " is-missing"}">
            ${otherPhoto
              ? `<img src="${escapeHTML(otherPhoto)}" alt="${escapeHTML(other.name || "")}" loading="lazy" />`
              : `<i>${escapeHTML(String(other.name || "?").slice(0, 1))}</i>`}
          </span>
          <span class="collaboration-person-copy">
            <strong>${escapeHTML(other.name || "")}</strong>
            <small>${usPartyAccentHTML(other.party || "")} · ${escapeHTML(other.districtCode || "")}</small>
          </span>
          <span class="collaboration-line" aria-hidden="true"></span>
          <span class="collaboration-count"><strong>${collaborator.billCount || 0}</strong></span>
        </summary>
        <div class="collaboration-bills">
          ${sharedBills.map((bill) => {
            const detailLink = safeExternalUrl(bill.detailLink);
            return `
              <a href="${escapeHTML(detailLink || "#")}" ${detailLink ? 'target="_blank" rel="noopener noreferrer"' : ""}>
                <span>${escapeHTML([bill.billNo, formatProposalDate(bill.proposalDate)].filter(Boolean).join(" · "))}</span>
                <strong>${escapeHTML(bill.title || "")}</strong>
              </a>`;
          }).join("")}
          <a class="collaboration-profile-link" href="${escapeHTML(profileUrl)}">View ${escapeHTML(other.name || "")} →</a>
        </div>
      </details>`;
  }).join("");

  list.querySelectorAll(".collaboration-person").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      list.querySelectorAll(".collaboration-person[open]").forEach((other) => {
        if (other !== details) other.removeAttribute("open");
      });
    });
  });
  section.hidden = false;
}

function renderUSVoteSimilarity(member, members, evidence) {
  const section = document.getElementById("us-collaboration-section");
  const stats = document.getElementById("us-collaboration-stats");
  const origin = document.getElementById("us-collaboration-origin");
  const list = document.getElementById("us-collaboration-list");
  const eyebrow = document.getElementById("us-network-eyebrow");
  const headline = document.getElementById("us-network-headline");
  if (!section || !stats || !origin || !list) return;
  const memberIndex = new Map(members.map((row) => [String(row.bioguideId || "").trim().toUpperCase(), row]));
  const network = evidence?.members?.[String(member.bioguideId || "").trim().toUpperCase()];
  const matches = Array.isArray(network?.topMatches)
    ? network.topMatches.map((match) => ({ ...match, member: memberIndex.get(match.bioguideId) })).filter((match) => match.member)
    : [];
  if (!matches.length) return;

  if (eyebrow) eyebrow.textContent = "119th Congress · Roll calls";
  if (headline) headline.textContent = "Similar voting records.";
  const photo = safeExternalUrl(member.photo);
  origin.innerHTML = `
    <div class="collaboration-origin-photo${photo ? "" : " is-missing"}">
      ${photo
        ? `<img src="${escapeHTML(photo)}" alt="${escapeHTML(member.name || "")}" />`
        : `<span>${escapeHTML(String(member.name || "?").slice(0, 1))}</span>`}
    </div>
    <strong>${escapeHTML(member.name || "")}</strong>`;
  stats.innerHTML = `<span><strong>${network.eligibleVoteCount || 0}</strong> compared votes</span>`;
  list.innerHTML = matches.slice(0, 5).map((match) => {
    const other = match.member;
    const otherPhoto = safeExternalUrl(other.photo);
    return `
      <a class="collaboration-person similarity-person" href="member.html?district=${encodeURIComponent(other.districtCode || "")}">
        <span class="collaboration-person-photo${otherPhoto ? "" : " is-missing"}">
          ${otherPhoto
            ? `<img src="${escapeHTML(otherPhoto)}" alt="${escapeHTML(other.name || "")}" loading="lazy" />`
            : `<i>${escapeHTML(String(other.name || "?").slice(0, 1))}</i>`}
        </span>
        <span class="collaboration-person-copy">
          <strong>${escapeHTML(other.name || "")}</strong>
          <small>${usPartyAccentHTML(other.party || "")} · ${escapeHTML(other.districtCode || "")} · ${match.commonVoteCount || 0} shared</small>
        </span>
        <span class="collaboration-line" aria-hidden="true"></span>
        <span class="collaboration-count"><strong>${Number(match.agreementRate || 0).toFixed(1)}%</strong></span>
      </a>`;
  }).join("");
  section.hidden = false;
}

const US_RELATIONSHIP_POSITIONS = [
  [14, 24], [35, 12], [74, 16], [88, 46], [70, 81], [27, 82],
];

function usSharedPartyBreakCount(leftId, rightId, evidence) {
  const rowsFor = (id) => evidence?.members?.[String(id || "").trim().toUpperCase()]?.partyBreaks || [];
  const leftKeys = new Set(rowsFor(leftId).map((row) => String(row?.voteKey || "")).filter(Boolean));
  return rowsFor(rightId).filter((row) => leftKeys.has(String(row?.voteKey || ""))).length;
}

function buildUSRelationshipCandidates(member, members, collaborationEvidence, similarityEvidence, voteEvidence) {
  const memberIndex = new Map(members.map((row) => [String(row.bioguideId || "").trim().toUpperCase(), row]));
  const memberId = String(member.bioguideId || "").trim().toUpperCase();
  const collaboration = collaborationEvidence?.members?.[memberId];
  const similarity = similarityEvidence?.members?.[memberId];
  const candidates = new Map();
  const ensure = (id) => {
    const key = String(id || "").trim().toUpperCase();
    const profile = memberIndex.get(key);
    if (!key || !profile) return null;
    if (!candidates.has(key)) candidates.set(key, { key, member: profile, sameParty: member.party === profile.party });
    return candidates.get(key);
  };
  for (const row of collaboration?.topCollaborators || []) {
    const candidate = ensure(row.bioguideId);
    if (candidate) candidate.collaboration = row;
  }
  for (const row of similarity?.topMatches || []) {
    const candidate = ensure(row.bioguideId);
    if (candidate) candidate.similarity = row;
  }
  const maxBills = Math.max(1, ...[...candidates.values()].map((candidate) => Number(candidate.collaboration?.billCount || 0)));
  for (const candidate of candidates.values()) {
    const billCount = Number(candidate.collaboration?.billCount || 0);
    const agreementRate = Number(candidate.similarity?.agreementRate || 0);
    const commonVoteCount = Number(candidate.similarity?.commonVoteCount || 0);
    candidate.billStrength = billCount ? Math.log1p(billCount) / Math.log1p(maxBills) : 0;
    candidate.voteStrength = agreementRate ? Math.max(0, (agreementRate - 50) / 50) * Math.min(commonVoteCount / 50, 1) : 0;
    candidate.sharedPartyBreaks = usSharedPartyBreakCount(memberId, candidate.key, voteEvidence);
    candidate.overallStrength = candidate.billStrength * 0.48 + candidate.voteStrength * 0.4 + Math.min(candidate.sharedPartyBreaks / 3, 1) * 0.12;
  }
  return [...candidates.values()];
}

function selectUSRelationshipCandidates(member, members, collaborationEvidence, similarityEvidence, voteEvidence, view) {
  const candidates = buildUSRelationshipCandidates(member, members, collaborationEvidence, similarityEvidence, voteEvidence);
  const strengthFor = (candidate) => view === "collaboration" ? candidate.billStrength : view === "similarity" ? candidate.voteStrength : candidate.overallStrength;
  const filtered = candidates
    .filter((candidate) => view === "collaboration" ? candidate.collaboration : view === "similarity" ? candidate.similarity : true)
    .sort((a, b) => strengthFor(b) - strengthFor(a) || String(a.member.name || "").localeCompare(String(b.member.name || ""), "en"));
  const selected = filtered.slice(0, 6);
  if (view === "all") {
    const otherParty = filtered.find((candidate) => !candidate.sameParty);
    if (otherParty && !selected.includes(otherParty) && selected.length) selected[selected.length - 1] = otherParty;
  }
  return selected.map((candidate) => ({ ...candidate, strength: strengthFor(candidate) }));
}

function renderUSRelationshipDetail(member, relation) {
  const detail = document.getElementById("us-relationship-detail");
  if (!detail || !relation) return;
  const other = relation.member;
  const metrics = [];
  if (relation.collaboration) {
    const directed = [
      relation.collaboration.ledByMemberCount ? `My bills ${relation.collaboration.ledByMemberCount}` : "",
      relation.collaboration.ledByCollaboratorCount ? `Their bills ${relation.collaboration.ledByCollaboratorCount}` : "",
    ].filter(Boolean).join(" · ");
    metrics.push(`<div><strong>${relation.collaboration.billCount || 0}</strong><span>Shared bills${directed ? `<small>${directed}</small>` : ""}</span></div>`);
  }
  if (relation.similarity) metrics.push(`<div><strong>${Number(relation.similarity.agreementRate || 0).toFixed(1)}%</strong><span>Vote agreement<small>${relation.similarity.commonVoteCount || 0} shared votes</small></span></div>`);
  if (relation.sharedPartyBreaks) metrics.push(`<div><strong>${relation.sharedPartyBreaks}</strong><span>Shared party breaks</span></div>`);
  detail.innerHTML = `
    <div class="relationship-detail-title">
      <span>${escapeHTML(member.name || "")} × ${escapeHTML(other.name || "")}</span>
      <a href="member.html?district=${encodeURIComponent(other.districtCode || "")}">View ${escapeHTML(other.name || "")} →</a>
    </div>
    <div class="relationship-metrics">${metrics.join("")}</div>`;
}

function renderUSRelationshipNetwork(member, members, collaborationEvidence, similarityEvidence, voteEvidence, view = "all") {
  const section = document.getElementById("us-collaboration-section");
  const stage = document.getElementById("us-relationship-stage");
  const stats = document.getElementById("us-collaboration-stats");
  const eyebrow = document.getElementById("us-network-eyebrow");
  const headline = document.getElementById("us-network-headline");
  if (!section || !stage || !stats) return;
  const relations = selectUSRelationshipCandidates(member, members, collaborationEvidence, similarityEvidence, voteEvidence, view);
  if (!relations.length) { section.hidden = true; return; }
  const labels = {
    all: ["119th Congress · Political network", "Who they move with."],
    collaboration: ["119th Congress · Cosponsorship", "Frequent collaborators."],
    similarity: ["119th Congress · Roll calls", "Similar voting records."],
  };
  if (eyebrow) eyebrow.textContent = labels[view]?.[0] || labels.all[0];
  if (headline) headline.textContent = labels[view]?.[1] || labels.all[1];
  stats.innerHTML = `<span><strong>${relations.length}</strong> connected members</span>`;
  const centerPhoto = member.bioguideId ? `/img/us/members/${encodeURIComponent(member.bioguideId)}.jpg` : safeExternalUrl(member.photo);
  const lineClass = view === "collaboration" ? "is-collaboration" : view === "similarity" ? "is-similarity" : "is-combined";
  stage.innerHTML = `
    <svg class="relationship-bonds" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="relationship-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0071e3"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
      ${relations.map((relation, index) => {
        const [x, y] = US_RELATIONSHIP_POSITIONS[index];
        return `<line class="relationship-bond ${lineClass}" x1="50" y1="50" x2="${x}" y2="${y}" style="--bond-width:${(1.1 + Math.max(0.15, relation.strength) * 2.8).toFixed(2)}"/>`;
      }).join("")}
    </svg>
    <div class="relationship-center">
      <span class="relationship-center-photo${centerPhoto ? "" : " is-missing"}">${centerPhoto ? `<img src="${escapeHTML(centerPhoto)}" alt="${escapeHTML(member.name || "")}" />` : escapeHTML(String(member.name || "?").slice(0, 1))}</span>
      <strong>${escapeHTML(member.name || "")}</strong>
    </div>
    ${relations.map((relation, index) => {
      const [x, y] = US_RELATIONSHIP_POSITIONS[index];
      const other = relation.member;
      const photo = other.bioguideId ? `/img/us/members/${encodeURIComponent(other.bioguideId)}.jpg` : safeExternalUrl(other.photo);
      const nodeSize = Math.round(54 + Math.max(0.15, relation.strength) * 18);
      return `<button class="relationship-node${index === 0 ? " is-selected" : ""}" type="button" data-relation-index="${index}" style="--node-x:${x}%;--node-y:${y}%;--node-size:${nodeSize}px" aria-label="${escapeHTML(other.name || "")}">
        <span class="relationship-node-photo${photo ? "" : " is-missing"}">${photo ? `<img src="${escapeHTML(photo)}" alt="" loading="lazy" />` : `<i>${escapeHTML(String(other.name || "?").slice(0, 1))}</i>`}</span>
        <strong>${escapeHTML(other.name || "")}</strong>
      </button>`;
    }).join("")}`;
  stage.querySelectorAll("[data-relation-index]").forEach((button) => {
    button.addEventListener("click", () => {
      stage.querySelectorAll(".relationship-node").forEach((node) => node.classList.toggle("is-selected", node === button));
      renderUSRelationshipDetail(member, relations[Number(button.dataset.relationIndex)]);
    });
  });
  renderUSRelationshipDetail(member, relations[0]);
  section.hidden = false;
}

function initUSNetworkTabs(member, members, collaborationEvidence, similarityEvidence, voteEvidence) {
  const section = document.getElementById("us-collaboration-section");
  if (!section || section.dataset.tabsReady === "true") return;
  section.dataset.tabsReady = "true";
  section.querySelectorAll("[data-network-view]").forEach((button) => {
    button.addEventListener("click", () => {
      section.querySelectorAll("[data-network-view]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderUSRelationshipNetwork(member, members, collaborationEvidence, similarityEvidence, voteEvidence, button.dataset.networkView || "all");
    });
  });
}

function renderCampaignFinance(finance) {
  if (!finance || !Number.isFinite(Number(finance.totalReceipts))) return "";

  const receipts = Number(finance.totalReceipts) || 0;
  const individual = Number(finance.individualContributions) || 0;
  const pac = Number(finance.pacContributions) || 0;
  const candidate = Number(finance.candidateFunding) || 0;
  const individualPct = receipts > 0 ? Math.round((individual / receipts) * 100) : 0;
  const pacPct = receipts > 0 ? Math.round((pac / receipts) * 100) : 0;
  const sourceUrl = safeExternalUrl(finance.sourceUrl);
  const cycleStart = Number(finance.cycle) - 1;
  const topContributors = Array.isArray(finance.topCommitteeContributors)
    ? finance.topCommitteeContributors.slice(0, 5)
    : [];

  return `
    <section class="finance-section">
      <div class="finance-inner">
        <p class="finance-kicker fade-in">Campaign money · ${escapeHTML(`${cycleStart}–${finance.cycle}`)}</p>
        <h2 class="finance-total fade-in delay-1">${escapeHTML(formatUSD(receipts))} raised.</h2>
        <p class="finance-context fade-in delay-2">Federal campaign filings for the ${escapeHTML(`${cycleStart}–${finance.cycle}`)} election cycle.</p>

        <div class="finance-grid fade-in">
          <div class="finance-metric">
            <strong>${escapeHTML(`${individualPct}%`)}</strong>
            <span>From individuals</span>
            <small>${escapeHTML(formatUSD(individual))}</small>
          </div>
          <div class="finance-metric">
            <strong>${escapeHTML(`${pacPct}%`)}</strong>
            <span>From PACs & committees</span>
            <small>${escapeHTML(formatUSD(pac))}</small>
          </div>
          <div class="finance-metric">
            <strong>${escapeHTML(formatUSD(candidate))}</strong>
            <span>Candidate funding</span>
            <small>Contributions and loans</small>
          </div>
          <div class="finance-metric">
            <strong>${escapeHTML(formatUSD(finance.cashOnHand))}</strong>
            <span>Cash on hand</span>
            <small>${escapeHTML(formatUSD(finance.totalDisbursements))} spent</small>
          </div>
        </div>

        ${topContributors.length ? `
          <details class="finance-contributors fade-in">
            <summary>
              <span>Top PAC & committee contributors</span>
              <small>View ${topContributors.length}</small>
            </summary>
            <div class="finance-contributor-list">
              ${topContributors.map((contributor) => {
                const contributorUrl = safeExternalUrl(contributor.sourceUrl);
                const name = escapeHTML(contributor.name || contributor.committeeId || "Political committee");
                return `
                  <div class="finance-contributor-row">
                    ${contributorUrl
                      ? `<a href="${escapeHTML(contributorUrl)}" target="_blank" rel="noopener noreferrer">${name} ↗</a>`
                      : `<span>${name}</span>`}
                    <strong>${escapeHTML(formatUSD(contributor.amount))}</strong>
                  </div>`;
              }).join("")}
              <p>Direct contributions and in-kind contributions reported by political committees. Independent expenditures are not included.</p>
            </div>
          </details>
        ` : ""}

        ${sourceUrl ? `<a class="finance-source fade-in" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">View official FEC filing ↗</a>` : ""}
      </div>
    </section>
  `;
}

function renderMember(member) {
  const root = document.getElementById("us-member-root");
  if (!root) return;

  const votesWithParty = formatPct(member.votesWithPartyPct);
  const billsSponsored = formatInt(member.billsSponsored);
  const missedVotes = member.missedVotesCount !== undefined && member.missedVotesCount !== null
    ? formatInt(member.missedVotesCount)
    : formatPct(member.missedVotesPct);

  const photoSrc = escapeHTML(member.photo || "");
  const memberName = escapeHTML(member.name || "");
  const districtCode = escapeHTML(member.districtCode || "");
  const partyHTML = usPartyAccentHTML(member.party || "");

  const posterPhoto = photoSrc
    ? `<img class="member-poster-photo" src="${photoSrc}" alt="${memberName}" loading="eager" />`
    : `<div class="member-poster-photo" style="background:#111;display:flex;align-items:center;justify-content:center;font-size:96px;color:rgba(245,245,247,0.1)">${escapeHTML((member.name || "?")[0])}</div>`;

  const sharePhoto = photoSrc
    ? `<img class="share-card-photo" src="${photoSrc}" alt="${memberName}" loading="lazy" />`
    : `<div class="share-card-photo" style="background:#111;display:flex;align-items:center;justify-content:center;font-size:80px;color:rgba(245,245,247,0.1)">${escapeHTML((member.name || "?")[0])}</div>`;

  root.innerHTML = `
    <section class="member-poster">
      <div class="member-poster-media">
        ${posterPhoto}
        <div class="member-poster-overlay"></div>
      </div>

      <div class="member-poster-content">
        <p class="poster-kicker">US House Representative</p>
        <h1 class="poster-name">${memberName}</h1>
        <p class="poster-meta">${districtCode}&nbsp;&nbsp;${partyHTML}</p>
      </div>

      <div class="scroll-hint">
        <span class="scroll-hint-arrow">↓</span>
        <span>Scroll for record</span>
      </div>
    </section>

    <section class="stat-section section--dark">
      <div class="stat-frame">
        <div class="stat-number fade-in" ${statNumAttrs(member.votesWithPartyPct, "%")}>${votesWithParty}</div>
        <div class="stat-label fade-in delay-1">Votes With Party</div>
        <div class="stat-context fade-in delay-2">How often this member voted with their party majority.</div>
      </div>
    </section>

    <section class="stat-section section--light">
      <div class="stat-frame stat-frame--light">
        <div class="stat-number fade-in" ${statNumAttrs(member.billsSponsored, "")}>${billsSponsored}</div>
        <div class="stat-label fade-in delay-1">Bills Sponsored</div>
        <div class="stat-context fade-in delay-2">Number of bills introduced in the current Congress.</div>
      </div>
    </section>

    <section class="stat-section section--dark">
      <div class="stat-frame">
        <div class="stat-number fade-in" ${statNumAttrs(member.missedVotesCount ?? member.missedVotesPct, member.missedVotesCount !== undefined && member.missedVotesCount !== null ? "" : "%")}>${missedVotes}</div>
        <div class="stat-label fade-in delay-1">Missed Votes</div>
        <div class="stat-context fade-in delay-2">Number of missed roll-call votes in the House.</div>
      </div>
    </section>

    ${renderCampaignFinance(member.campaignFinance)}

    <section class="votes-section" id="member-votes">
      <div class="votes-inner">
        <h2 class="votes-header fade-in">How they voted.</h2>
        <p class="votes-subheader fade-in delay-1" id="vote-list-context">Latest final-passage votes in the House.</p>
        <div class="vote-view-tabs fade-in delay-1" id="vote-view-tabs">
          <button class="vote-view-tab is-active" type="button" data-vote-view="final">Final votes</button>
          <button class="vote-view-tab" type="button" data-vote-view="preliminary">Amendments & procedure</button>
          <button class="vote-view-tab" type="button" data-vote-view="party-breaks">Party breaks <span>${escapeHTML(formatInt(member.partyDifferentVotesCount))}</span></button>
        </div>
        <div id="vote-list"><p class="vote-list-loading">Loading vote records…</p></div>
        <div class="vote-list-more" id="vote-list-more"></div>
      </div>
    </section>

    <section class="activity-section">
      <div class="activity-inner">
        <div class="activity-header fade-in">Recent Sponsored Bills</div>
        <div id="activity-wrap">${renderBills(member.recentBills || [])}</div>
      </div>
    </section>

    <section class="collaboration-story" id="us-collaboration-section" hidden>
      <div class="collaboration-shell">
        <p class="collaboration-eyebrow" id="us-network-eyebrow">119th Congress · Political network</p>
        <h2 class="collaboration-headline" id="us-network-headline">Who they move with.</h2>
        <div class="network-tabs" aria-label="Network view">
          <button class="network-tab is-active" type="button" data-network-view="all">All</button>
          <button class="network-tab" type="button" data-network-view="collaboration">Cosponsorship</button>
          <button class="network-tab" type="button" data-network-view="similarity">Votes</button>
        </div>
        <div class="collaboration-stats" id="us-collaboration-stats"></div>
        <div class="relationship-stage" id="us-relationship-stage"></div>
        <div class="relationship-detail" id="us-relationship-detail"></div>
      </div>
    </section>

    <section class="share-section">
      <article class="share-card" id="rep-summary">
        <div class="share-card-photo-wrap">${sharePhoto}</div>
        <div class="share-card-body">
          <p class="share-card-kicker">US House Representative</p>
          <h3 class="share-card-name">${memberName}</h3>
          <p class="share-card-meta">${districtCode}&nbsp;&nbsp;${partyHTML}</p>
          <div class="share-card-stats">
            <div class="share-stat-item">
              <span class="share-stat-num">${votesWithParty}</span>
              <span class="share-stat-label">Votes With Party</span>
            </div>
            <div class="share-stat-item">
              <span class="share-stat-num">${billsSponsored}</span>
              <span class="share-stat-label">Bills Sponsored</span>
            </div>
            <div class="share-stat-item">
              <span class="share-stat-num">${missedVotes}</span>
              <span class="share-stat-label">Missed Votes</span>
            </div>
          </div>
          <p class="rep-watermark" style="display:none;margin-top:16px">RepView</p>
        </div>
      </article>

      <div class="share-actions">
        <button id="save-image-btn" class="share-action-btn" type="button">Save Image</button>
        <button id="share-btn" class="share-action-btn" type="button">Share</button>
      </div>
    </section>

    ${renderDataAsOf(member)}
  `;

  document.title = `${member.name} (${member.districtCode}) — RepView US`;

  const navName = document.getElementById("nav-member-name");
  if (navName) {
    const nameObserver = new IntersectionObserver(
      ([entry]) => navName.classList.toggle("visible", !entry.isIntersecting),
      { threshold: 0.1 }
    );
    const posterEl = root.querySelector(".member-poster");
    if (posterEl) nameObserver.observe(posterEl);
    navName.textContent = member.name || "";
  }

  const fadeObserver = new IntersectionObserver(
    (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible"); }),
    { threshold: 0.08 }
  );
  root.querySelectorAll(".fade-in").forEach((el) => fadeObserver.observe(el));

  initCounters(root);
}

function initVoteExplorer(member) {
  const tabs = document.getElementById("vote-view-tabs");
  const list = document.getElementById("vote-list");
  const context = document.getElementById("vote-list-context");
  const moreWrap = document.getElementById("vote-list-more");
  if (!tabs || !list || !context || !moreWrap) return;

  let mode = "final";
  let evidence = null;
  let visiblePartyBreaks = 20;

  function revealRows() {
    list.querySelectorAll(".fade-in").forEach((element) => element.classList.add("visible"));
  }

  function updateQuery(nextMode) {
    const url = new URL(window.location.href);
    if (nextMode === "party-breaks") url.searchParams.set("view", "party-breaks");
    else if (nextMode === "preliminary") url.searchParams.set("view", "preliminary");
    else url.searchParams.delete("view");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function setActiveTab() {
    tabs.querySelectorAll("[data-vote-view]").forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-vote-view") === mode);
    });
  }

  function renderFinal() {
    context.textContent = "Latest final-passage votes in the House.";
    list.innerHTML = renderVotes(evidence?.final || [], 10, "No recent final votes recorded.");
    moreWrap.innerHTML = "";
    revealRows();
  }

  function renderPreliminary() {
    context.textContent = "Latest amendments, motions to recommit, and procedural House votes.";
    list.innerHTML = renderVotes(evidence?.preliminary || [], 10, "No recent preliminary votes recorded.");
    moreWrap.innerHTML = "";
    revealRows();
  }

  function renderPartyBreaks() {
    const rows = evidence?.partyBreaks || [];
    context.textContent = `Votes where ${member.name} differed from the majority of their party's members voting Yes or No.`;
    list.innerHTML = renderVotes(rows, visiblePartyBreaks, "No party-break votes recorded in the current Congress.");
    moreWrap.innerHTML = rows.length > visiblePartyBreaks
      ? `<button class="vote-list-more-button" type="button">Show ${Math.min(20, rows.length - visiblePartyBreaks)} more</button>`
      : "";
    revealRows();
  }

  async function activate(nextMode, { syncQuery = true } = {}) {
    mode = nextMode === "party-breaks"
      ? "party-breaks"
      : nextMode === "preliminary" ? "preliminary" : "final";
    setActiveTab();
    if (syncQuery) updateQuery(mode);

    context.textContent = "Loading vote records…";
    list.innerHTML = '<p class="vote-list-loading">Loading vote records…</p>';
    moreWrap.innerHTML = "";
    try {
      if (!evidence) evidence = await loadMemberVoteEvidence(member.bioguideId);
    } catch (error) {
      console.error(error);
      context.textContent = "Vote records could not be loaded.";
      list.innerHTML = "";
      return;
    }

    if (mode === "final") {
      renderFinal();
      return;
    }

    if (mode === "preliminary") {
      renderPreliminary();
      return;
    }

    renderPartyBreaks();
  }

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-vote-view]");
    if (!button) return;
    visiblePartyBreaks = 20;
    activate(button.getAttribute("data-vote-view"));
  });

  moreWrap.addEventListener("click", (event) => {
    if (!event.target.closest(".vote-list-more-button")) return;
    visiblePartyBreaks += 20;
    renderPartyBreaks();
  });

  const requestedMode = new URLSearchParams(window.location.search).get("view");
  const initialMode = requestedMode === "party-breaks"
    ? "party-breaks"
    : requestedMode === "preliminary" ? "preliminary" : "final";
  activate(initialMode, { syncQuery: false });
}

function buildShareText(member) {
  const district = String(member.districtCode || "").trim();
  const name = String(member.name || "").trim();
  return `${district} Representative ${name}\n\nVotes with Party, Bills Sponsored, and Missed Votes at a glance.\n\nRepView\n${window.location.href}`;
}

function initShareActions(member) {
  const saveBtn = document.getElementById("save-image-btn");
  const shareBtn = document.getElementById("share-btn");

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const card = document.getElementById("rep-summary");
      if (!card || typeof html2canvas !== "function") return;
      try {
        const images = Array.from(card.querySelectorAll("img"));
        await Promise.all(images.map(async (img) => {
          if (img.complete && img.naturalWidth > 0) return;
          try {
            await img.decode();
          } catch (_) {
            await new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            });
          }
        }));

        const canvas = await html2canvas(card, {
          scale: 2,
          backgroundColor: "#050505",
          useCORS: true,
          allowTaint: false,
          imageTimeout: 15000,
          onclone: (doc) => {
            const mark = doc.querySelector("#rep-summary .rep-watermark");
            if (mark) mark.style.display = "block";
          },
        });
        const link = document.createElement("a");
        link.download = `repview_us_${(member.name || "member").replace(/\s+/g, "_")}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } catch (err) {
        console.error(err);
        alert("Failed to save image. Please try again.");
      }
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const text = buildShareText(member);
      if (navigator.share) {
        try { await navigator.share({ text }); } catch (_) { /* user cancelled */ }
      } else {
        try {
          await navigator.clipboard.writeText(text);
          alert("Share text copied.");
        } catch (err) { console.error(err); }
      }
    });
  }
}

async function initUSMemberPage() {
  const params = new URLSearchParams(window.location.search);
  const districtParam = normalizeDistrictCode(params.get("district"));

  if (!districtParam) {
    renderFallback("No district specified. Use ?district=ca-11 format.");
    return;
  }

  let members = [];
  try {
    members = await loadUSMembers();
  } catch (err) {
    console.error(err);
    renderFallback("Failed to load US member dataset.");
    return;
  }

  const member = members.find((m) => normalizeDistrictCode(m.districtCode) === districtParam);

  if (!member) {
    renderFallback(`No House member found for district "${districtParam}".`);
    return;
  }

  renderMember(member);
  initVoteExplorer(member);
  initShareActions(member);
  trackUSMemberView(member.districtCode);

  Promise.all([
    loadUSCollaborationEvidence().catch((error) => {
      console.error(error);
      return null;
    }),
    loadUSVoteSimilarityEvidence().catch((error) => {
      console.error(error);
      return null;
    }),
    loadUSVoteEvidenceData().catch((error) => {
      console.error(error);
      return null;
    }),
  ])
    .then(([collaborationEvidence, similarityEvidence, voteEvidence]) => {
      renderUSRelationshipNetwork(member, members, collaborationEvidence, similarityEvidence, voteEvidence, "all");
      initUSNetworkTabs(member, members, collaborationEvidence, similarityEvidence, voteEvidence);
    });
}

document.addEventListener("DOMContentLoaded", initUSMemberPage);
