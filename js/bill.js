const BILL_SHARD_COUNT = 32;

function billShard(value) {
  let hash = 0;
  for (const char of String(value || "").trim()) hash = (hash + char.charCodeAt(0)) % BILL_SHARD_COUNT;
  return String(hash).padStart(2, "0");
}

function billDate(value, compact = false) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  const year = digits.slice(0, 4);
  const month = String(Number(digits.slice(4, 6)));
  const day = String(Number(digits.slice(6, 8)));
  return compact ? `${month}.${day}` : `${year}. ${month}. ${day}.`;
}

function billStatusClass(status) {
  if (/가결/.test(status)) return "is-passed";
  if (/계류|심사/.test(status)) return "is-pending";
  if (/대안반영/.test(status)) return "is-alternative";
  return "is-closed";
}

function billMemberRoute(profile) {
  if (!profile) return "";
  if (profile.slug) return `member.html?slug=${encodeURIComponent(profile.slug)}`;
  return profile.code ? `member.html?id=${encodeURIComponent(profile.code)}` : "";
}

function initBillBackLink(profiles) {
  const link = document.getElementById("bill-back-link");
  if (!link || !document.referrer) return;
  try {
    const previous = new URL(document.referrer);
    const fromMember = previous.origin === window.location.origin
      && /\/(?:pages\/kr\/|kr\/)?member\.html$/.test(previous.pathname);
    if (!fromMember) return;
    const params = previous.searchParams;
    const key = params.get("slug") || params.get("id") || "";
    const profile = Object.values(profiles || {}).find(
      (member) => member.slug === key || member.code === key
    );
    link.textContent = `← ${profile?.name || "의원으로"}`;
    link.href = previous.href;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      history.back();
    });
  } catch (_) {
    // Keep the RepView fallback when the referrer is unavailable or invalid.
  }
}

function billPersonHTML(profile, size = "lead") {
  const name = profile?.name || "의원 정보 없음";
  const route = billMemberRoute(profile);
  const content = `
    <span class="bill-person-photo${profile?.photo ? "" : " is-missing"}">
      ${profile?.photo
        ? `<img src="${escapeHTML(profile.photo)}" alt="${escapeHTML(name)}" loading="lazy" />`
        : `<i>${escapeHTML(name.slice(0, 1))}</i>`}
    </span>
    <span class="bill-person-copy">
      <strong>${escapeHTML(name)}</strong>
      ${profile?.party ? `<small>${partyAccentHTML(profile.party)}</small>` : ""}
    </span>`;
  return route
    ? `<a class="bill-person bill-person--${size}" href="${escapeHTML(route)}">${content}</a>`
    : `<div class="bill-person bill-person--${size}">${content}</div>`;
}

function eventSummary(bill) {
  const proposed = billDate(bill.proposalDate);
  const processed = billDate(bill.timeline?.plenaryProcessedDate || bill.vote?.date);
  const committee = String(bill.committee || "").trim();
  if (proposed && processed) {
    return `${proposed} 발의되어${committee ? ` ${committee} 심사를 거쳐` : ""} ${processed} 본회의에서 ${bill.status}됐습니다.`;
  }
  if (proposed && bill.status === "계류") {
    return `${proposed} 발의되어${committee ? ` ${committee}에서` : " 국회에서"} 심사 중입니다.`;
  }
  if (proposed) return `${proposed} 발의된 뒤 현재 ${bill.status} 상태입니다.`;
  if (processed) return `${processed} 본회의에서 ${bill.status}된 안건입니다.`;
  return `제22대 국회에서 다뤄진 ${bill.status} 안건입니다.`;
}

function renderBillPeople(bill, profiles) {
  const leads = (bill.leadCodes || []).map((code) => profiles[code]).filter(Boolean);
  const leadEl = document.getElementById("bill-leads");
  if (leads.length) {
    leadEl.innerHTML = leads.map((profile) => billPersonHTML(profile, "lead")).join("");
  } else {
    leadEl.innerHTML = `<div class="bill-proposer-label">${escapeHTML(bill.proposerLabel || "위원회 제안 안건")}</div>`;
  }

  const cosponsors = (bill.cosponsorCodes || []).map((code) => profiles[code]).filter(Boolean);
  const block = document.getElementById("bill-cosponsors");
  block.hidden = cosponsors.length === 0;
  if (!cosponsors.length) return;

  document.getElementById("bill-cosponsor-title").textContent = `공동발의 ${cosponsors.length}명`;
  const partyCounts = new Map();
  for (const profile of [...leads, ...cosponsors]) {
    if (!profile.party) continue;
    partyCounts.set(profile.party, (partyCounts.get(profile.party) || 0) + 1);
  }
  document.getElementById("bill-party-composition").textContent = [...partyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([party, count]) => `${party.replace("더불어민주당", "민주").replace("국민의힘", "국민의힘")} ${count}`)
    .join(" · ");
  document.getElementById("bill-face-rail").innerHTML = cosponsors
    .map((profile) => billPersonHTML(profile, "small"))
    .join("");
}

function renderBillTimeline(bill) {
  const timeline = bill.timeline || {};
  const proposalDate = bill.proposalDate;
  const committeeDate = timeline.committeeProcessedDate || timeline.committeePresentedDate || timeline.committeeDate;
  const plenaryDate = timeline.plenaryProcessedDate || timeline.plenaryPresentedDate;
  const isFinished = bill.status !== "계류";
  const steps = [
    { label: "발의", date: proposalDate, done: Boolean(proposalDate) },
    { label: bill.committee || "위원회", date: committeeDate, done: Boolean(committeeDate) },
    { label: "본회의", date: plenaryDate, done: Boolean(plenaryDate) },
    { label: bill.status, date: isFinished ? plenaryDate : "", done: isFinished },
  ];
  document.getElementById("bill-timeline").innerHTML = steps.map((step, index) => `
    <div class="bill-timeline-step${step.done ? " is-done" : ""}">
      <span>${index + 1}</span>
      <strong>${escapeHTML(step.label)}</strong>
      <small>${escapeHTML(billDate(step.date, true) || (step.done ? "완료" : "—"))}</small>
    </div>`).join("");
}

function votePercent(value, total) {
  return total > 0 ? (Number(value || 0) / total) * 100 : 0;
}

function renderMemberVoteGroups(vote, profiles) {
  const labels = [
    ["yes", "찬성"], ["no", "반대"], ["abstain", "기권"], ["unrecorded", "미표결"],
  ];
  return labels.map(([key, label]) => {
    const people = (vote.members?.[key] || []).map((code) => profiles[code]).filter(Boolean);
    if (!people.length) return "";
    return `<section class="bill-member-vote-group">
      <h3>${label} <span>${people.length}</span></h3>
      <div>${people.map((profile) => billPersonHTML(profile, "vote")).join("")}</div>
    </section>`;
  }).join("");
}

function renderBillVote(vote, profiles) {
  const section = document.getElementById("bill-vote-section");
  section.hidden = !vote;
  if (!vote) return;
  document.getElementById("bill-yes-count").dataset.count = String(vote.yes || 0);
  document.getElementById("bill-yes-count").textContent = String(vote.yes || 0);
  document.getElementById("bill-vote-metrics").innerHTML = `
    <div><strong>${vote.no || 0}</strong><span>반대</span></div>
    <div><strong>${vote.abstain || 0}</strong><span>기권</span></div>
    <div><strong>${vote.unrecorded || 0}</strong><span>미표결</span></div>`;
  const total = Number(vote.memberCount || 0);
  document.getElementById("bill-vote-bar").innerHTML = `
    <i class="is-yes" style="width:${votePercent(vote.yes, total)}%"></i>
    <i class="is-no" style="width:${votePercent(vote.no, total)}%"></i>
    <i class="is-abstain" style="width:${votePercent(vote.abstain, total)}%"></i>
    <i class="is-unrecorded" style="width:${votePercent(vote.unrecorded, total)}%"></i>`;
  document.getElementById("bill-party-votes").innerHTML = (vote.parties || []).map((party) => `
    <div class="bill-party-vote-row">
      <strong>${escapeHTML(party.party)}</strong>
      <p>찬성 ${party.yes} · 반대 ${party.no} · 기권 ${party.abstain} · 미표결 ${party.unrecorded}</p>
    </div>`).join("");

  const details = document.getElementById("bill-member-votes");
  let rendered = false;
  details.addEventListener("toggle", () => {
    if (!details.open || rendered) return;
    document.getElementById("bill-member-vote-groups").innerHTML = renderMemberVoteGroups(vote, profiles);
    rendered = true;
  });
}

function renderBill(bill, profiles, manifest) {
  initBillBackLink(profiles);
  document.title = `${bill.title} — RepView`;
  document.getElementById("nav-bill-number").textContent = bill.no ? `의안 ${bill.no}` : "제22대 국회";
  document.getElementById("bill-eyebrow").textContent = ["제22대 국회", bill.no ? `의안번호 ${bill.no}` : ""].filter(Boolean).join(" · ");
  document.getElementById("bill-title").textContent = bill.title;
  document.getElementById("bill-summary").textContent = eventSummary(bill);
  const status = document.getElementById("bill-status");
  status.textContent = bill.status;
  status.className = `bill-status ${billStatusClass(bill.status)}`;
  document.getElementById("bill-proposal-date").textContent = bill.proposalDate ? `${billDate(bill.proposalDate)} 발의` : "";
  const processedDate = bill.timeline?.plenaryProcessedDate || bill.vote?.date;
  document.getElementById("bill-processed-date").textContent = processedDate ? `${billDate(processedDate)} 처리` : "";
  renderBillPeople(bill, profiles);
  renderBillTimeline(bill);
  renderBillVote(bill.vote, profiles);
  const officialLink = document.getElementById("bill-official-link");
  officialLink.hidden = !bill.officialUrl;
  if (bill.officialUrl) officialLink.href = bill.officialUrl;
  document.getElementById("bill-data-through").textContent = `법안 ${manifest.latestBillDate || ""} · 표결 ${manifest.latestVoteDate || ""} 기준`;
  document.getElementById("bill-content").hidden = false;
  initNav();
  initFadeIns();
  initCounters();
}

async function initBill() {
  const billId = new URLSearchParams(location.search).get("id")?.trim() || "";
  if (!billId) {
    document.getElementById("bill-error").hidden = false;
    return;
  }
  try {
    const [shard, profiles, manifest] = await Promise.all([
      loadJSON(`data/kr/bills/${billShard(billId)}.json`),
      loadJSON("data/kr/bills/members.json"),
      loadJSON("data/kr/bills/manifest.json"),
    ]);
    const bill = shard[billId];
    if (!bill) throw new Error("Bill not found");
    renderBill(bill, profiles, manifest);
  } catch (error) {
    console.error("Bill load error:", error);
    document.getElementById("bill-error").hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", initBill);
