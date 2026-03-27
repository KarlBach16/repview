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

function renderVotes(votes) {
  if (!Array.isArray(votes) || !votes.length) {
    return `<p style="color:rgba(245,245,247,0.3);font-size:15px;padding:20px 0">No recent vote records.</p>`;
  }

  return votes.slice(0, 10).map((v) => `
    <div class="vote-card fade-in">
      <div class="vote-card-left">
        <div class="vote-card-meta">
          <span class="vote-card-date">${escapeHTML(formatVoteDate(v.voteDate))}</span>
          <span class="vote-card-topic">${escapeHTML(v.billNo || "")}</span>
          <span class="vote-card-topic">${escapeHTML(v.voteLabel || "")}</span>
        </div>
        <div class="vote-card-title">${escapeHTML(v.title || "")}</div>
        ${v.question ? `<div class="vote-card-meta" style="margin-top:6px"><span class="vote-card-topic">${escapeHTML(v.question)}</span></div>` : ""}
      </div>
      <span class="vote-decision-badge ${choiceClass(v.choice)}">${escapeHTML(v.choice || "-")}</span>
    </div>
  `).join("");
}

function renderBills(bills) {
  if (!Array.isArray(bills) || !bills.length) {
    return `<p style="color:rgba(245,245,247,0.3);font-size:15px">No recent sponsored bills.</p>`;
  }

  return bills.slice(0, 10).map((b) => {
    const meta = [b.status, formatProposalDate(b.proposalDate)].filter(Boolean).join(" · ");
    return `
      <div class="activity-item fade-in">
        <span class="activity-dot activity-dot--ongoing"></span>
        <span>${escapeHTML(b.title || "")}${meta ? ` (${escapeHTML(meta)})` : ""}</span>
      </div>
    `;
  }).join("");
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

        <div class="poster-secondary">
          <div class="poster-secondary-item">
            <span class="poster-secondary-num">${votesWithParty}</span>
            <span class="poster-secondary-label">Votes With Party</span>
          </div>
          <div class="poster-secondary-item">
            <span class="poster-secondary-num">${billsSponsored}</span>
            <span class="poster-secondary-label">Bills Sponsored</span>
          </div>
          <div class="poster-secondary-item">
            <span class="poster-secondary-num">${missedVotes}</span>
            <span class="poster-secondary-label">Missed Votes</span>
          </div>
        </div>
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

    <section class="votes-section">
      <div class="votes-inner">
        <h2 class="votes-header fade-in">How they voted.</h2>
        <p class="votes-subheader fade-in delay-1">Latest House votes and this member's recorded choice.</p>
        <div id="vote-list">${renderVotes(member.recentVotes || [])}</div>
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
  initShareActions(member);
}

document.addEventListener("DOMContentLoaded", initUSMemberPage);
