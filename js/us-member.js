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

let voteEvidencePromise = null;

async function loadMemberVoteEvidence(bioguideId) {
  if (!voteEvidencePromise) {
    voteEvidencePromise = fetch("/data/us/vote_evidence.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load vote evidence: ${response.status}`);
        return response.json();
      });
  }
  const data = await voteEvidencePromise;
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
}

document.addEventListener("DOMContentLoaded", initUSMemberPage);
