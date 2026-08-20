// Staff In-Service Quiz — app logic
// Programs: 'dietary' (12 monthly modules, pass 100%) and 'dsd' (Yessi's calendar topics, pass 80%).
// Flow: pick community -> pick yourself (Paycom roster; role derived from position) ->
// personal checklist shows only your role's in-services, with completed ones checked off.
// Backend: Supabase Edge Function (roster + progress + records attempts; weekly report emails the owners)
const FUNC_URL = "https://pmnudshutxwidxdtouqj.supabase.co/functions/v1/dining-quiz";
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const PROGRAM = new URLSearchParams(location.search).get("p") === "dsd" ? "dsd" : "dietary";
const PASS_PCT = PROGRAM === "dsd" ? 80 : 100;
const PROGRAM_MODULES = PROGRAM === "dsd" ? DSD_MODULES : MODULES;
const MANUAL_ROLES = ["CNA", "Licensed Nurse", "Dietary Aide", "All Staff"];
const MANUAL_ROLE_LABELS = { "CNA": "CNA / RNA", "Licensed Nurse": "Licensed Nurse (LVN / RN)", "Dietary Aide": "Dietary / Culinary", "All Staff": "Other / Non-nursing" };

const $ = (id) => document.getElementById(id);
const screens = ["start", "review", "quiz", "signature", "saving", "result"];
function show(name) {
  screens.forEach(s => $("screen-" + s).classList.toggle("active", s === name));
  window.scrollTo(0, 0);
}

let state = { module: null, role: null, qIndex: 0, answers: [], facility: "", name: "", pending: null, submitting: false };
let roster = [];                       // [{n, r}] for the selected facility
let passedSet = new Set();             // module ids this person has passed
let user = { name: "", role: "", manual: false };

function lsGet(k){ try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k,v){ try { localStorage.setItem(k,v); } catch (e) {} }

// ---- Program branding ----
function brand() {
  $("passPctLabel").textContent = PASS_PCT + "%";
  if (PROGRAM === "dsd") {
    $("brandIcon").textContent = "🩺";
    $("appTitle").innerHTML = "Staff In-Service Quiz";
    $("appSub").innerHTML = `Pick your name to see your in-services. You must score <strong>${PASS_PCT}%</strong> or higher to pass — you can retake a quiz as many times as you need.`;
    $("appFine").textContent = "Results are recorded automatically and reported to the DSD (Yessi Flores).";
    document.title = "Staff In-Service Quiz";
  }
}

// ---- Module helpers ----
function moduleId(m) { return PROGRAM === "dsd" ? m.id : m.n; }
function moduleLabel(m) {
  return PROGRAM === "dsd"
    ? `${MONTH_NAMES[m.month - 1] ?? m.month} — ${m.title}`
    : `${m.month} — ${m.title}`;
}
function moduleMonthName(m) {
  return PROGRAM === "dsd" ? (MONTH_NAMES[m.month - 1] ?? String(m.month)) : String(m.month);
}
// Every assigned topic is shown to everyone; the role only picks which question set
// they get (non-nursing falls back to the CNA set, matching the pre-checklist app).
function roleKeyFor(m, role) {
  if (PROGRAM !== "dsd") return null;
  if (m.roles[role]) return role;
  if (m.roles["All Staff"]) return "All Staff";
  if (m.roles["CNA"]) return "CNA";
  return Object.keys(m.roles)[0];
}
// Two-month window: only this month and last month are shown at all.
function windowMonths() {
  const now = new Date();
  const cur = now.getMonth() + 1;
  const prev = cur === 1 ? 12 : cur - 1;
  return [cur, prev];
}
// assignedMap: dsd only — module id -> send_date (topics whose scheduled email went out).
// A dsd topic is in the list if it was SENT and the send date falls in the window.
// Dietary: module month must be in the window.
function inWindow(m, assignedMap) {
  const [cur, prev] = windowMonths();
  if (PROGRAM === "dsd") {
    const d = assignedMap ? assignedMap.get(moduleId(m)) : null;
    if (!d) return false;
    const mo = Number(String(d).slice(5, 7));
    return mo === cur || mo === prev;
  }
  const mo = MONTH_NAMES.indexOf(m.month) + 1;
  return mo === cur || mo === prev;
}
function questionsFor(m, roleKey) {
  return PROGRAM === "dsd" ? m.roles[roleKey] : m.questions;
}

// ---- Facilities ----
async function loadFacilities() {
  const sel = $("facility");
  try {
    const r = await fetch(FUNC_URL + "?facilities=1");
    const data = await r.json();
    sel.innerHTML = '<option value="">— Select your community —</option>';
    (data.facilities || []).forEach(f => {
      const o = document.createElement("option");
      o.value = f; o.textContent = f;
      sel.appendChild(o);
    });
    const other = document.createElement("option");
    other.value = "Other"; other.textContent = "Other";
    sel.appendChild(other);
  } catch (e) {
    sel.innerHTML = '<option value="">— Select —</option><option value="Other">Other / not listed</option>';
  }
}

// ---- Roster (select yourself) ----
async function loadRoster(facility) {
  roster = [];
  const sel = $("staffSelect");
  sel.innerHTML = '<option value="">Loading names…</option>';
  if (facility && facility !== "Other") {
    try {
      const r = await fetch(FUNC_URL + "?roster=1&facility=" + encodeURIComponent(facility));
      const data = await r.json();
      roster = data.staff || [];
    } catch (e) { roster = []; }
  }
  sel.innerHTML = '<option value="">— Find your name —</option>';
  roster.forEach((s, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = s.n;
    sel.appendChild(o);
  });
  const manual = document.createElement("option");
  manual.value = "__manual";
  manual.textContent = roster.length ? "— My name isn't listed —" : "— Type my name instead —";
  sel.appendChild(manual);
}

function populateManualRoles() {
  const sel = $("role");
  sel.innerHTML = "";
  MANUAL_ROLES.forEach(r => {
    const o = document.createElement("option");
    o.value = r; o.textContent = MANUAL_ROLE_LABELS[r];
    sel.appendChild(o);
  });
}

// ---- Progress + checklist ----
let assignedMap = null;   // dsd: module id -> send_date
async function loadProgress() {
  passedSet = new Set();
  const wants = [
    fetch(FUNC_URL + "?progress=1&program=" + PROGRAM +
      "&facility=" + encodeURIComponent(state.facility) +
      "&staff_name=" + encodeURIComponent(user.name)).then(r => r.json()).catch(() => ({}))
  ];
  if (PROGRAM === "dsd") {
    wants.push(fetch(FUNC_URL + "?assigned=1&program=dsd").then(r => r.json()).catch(() => ({})));
  }
  const [prog, sched] = await Promise.all(wants);
  (prog && prog.passed || []).forEach(n => passedSet.add(n));
  if (PROGRAM === "dsd") {
    assignedMap = new Map();
    (sched && sched.assigned || []).forEach(a => assignedMap.set(a.m, a.d));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderList() {
  $("manualBlock").style.display = "none";
  $("listBlock").style.display = "";
  const roleNote = PROGRAM === "dsd" ? " · " + (MANUAL_ROLE_LABELS[user.role] || user.role) : "";
  $("listWho").textContent = user.name + roleNote;

  const visible = PROGRAM_MODULES.filter(m => inWindow(m, assignedMap));
  // newest assignment first (dsd: by send date; dietary: by month)
  const sortKey = (m) => PROGRAM === "dsd"
    ? String(assignedMap.get(moduleId(m)) || "")
    : String(MONTH_NAMES.indexOf(m.month) + 1).padStart(2, "0");
  visible.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const todo = visible.filter(m => !passedSet.has(moduleId(m)));
  const done = visible.filter(m => passedSet.has(moduleId(m)));
  // "This week" chip: the most recent assignment (dsd) / current month (dietary)
  const newestKey = visible.length ? sortKey(visible[0]) : null;
  const isCurrent = (m) => PROGRAM === "dsd"
    ? sortKey(m) === newestKey
    : (MONTH_NAMES.indexOf(m.month) + 1) === (new Date().getMonth() + 1);

  const row = (m, isDone) => {
    const cur = !isDone && isCurrent(m);
    return `<button class="mod-row${isDone ? " done" : ""}${cur ? " now" : ""}" data-mid="${moduleId(m)}">` +
      `<span class="mod-ic">${isDone ? "✅" : "▶"}</span>` +
      `<span class="mod-t"><span class="mod-m">${escapeHtml(moduleMonthName(m))}</span>${escapeHtml(m.title)}</span>` +
      (cur ? '<span class="chip">' + (PROGRAM === "dsd" ? "Latest" : "This month") + '</span>' : "") +
      `</button>`;
  };

  $("todoList").innerHTML = todo.length
    ? todo.map(m => row(m, false)).join("")
    : `<div id="allDone">🎉 <b>All caught up${user.name ? ", " + escapeHtml(user.name.split(" ")[0]) : ""}!</b><br>You're current on your in-services for this month and last month.</div>`;

  const wrap = $("doneWrap");
  if (done.length) {
    wrap.style.display = "";
    $("doneSummary").textContent = `Completed ✓ (${done.length})`;
    $("doneList").innerHTML = done.map(m => row(m, true)).join("");
  } else {
    wrap.style.display = "none";
  }

  document.querySelectorAll(".mod-row").forEach(b => {
    b.onclick = () => startModule(Number(b.dataset.mid));
  });
}

function startModule(mid) {
  const m = PROGRAM_MODULES.find(x => moduleId(x) === mid);
  if (!m) return;
  state.module = m;
  state.name = user.name;
  state.role = PROGRAM === "dsd" ? user.role : null;
  state.roleKey = roleKeyFor(m, user.role);
  showReview();
}

// ---- Identity wiring ----
async function identityChosen(name, role, manual) {
  user = { name, role: role || "All Staff", manual: !!manual };
  lsSet("dq_fac", state.facility);
  lsSet("dq_name", user.name);
  lsSet("dq_role", user.role);
  lsSet("dq_manual", manual ? "1" : "");
  $("listBlock").style.display = "";
  $("todoList").innerHTML = '<div class="crumb">Loading your in-services…</div>';
  $("doneWrap").style.display = "none";
  $("listWho").textContent = user.name;
  await loadProgress();
  renderList();
}

$("facility").onchange = async () => {
  state.facility = $("facility").value.trim();
  $("listBlock").style.display = "none";
  $("manualBlock").style.display = "none";
  if (!state.facility) { $("staffSelect").innerHTML = '<option value="">— Select your community first —</option>'; return; }
  await loadRoster(state.facility);
};

$("staffSelect").onchange = () => {
  const v = $("staffSelect").value;
  $("listBlock").style.display = "none";
  if (v === "__manual") {
    $("manualBlock").style.display = "";
    $("roleBlock").style.display = PROGRAM === "dsd" ? "" : "none";
    $("staffName").focus();
    return;
  }
  $("manualBlock").style.display = "none";
  if (v === "") return;
  const s = roster[Number(v)];
  if (s) identityChosen(s.n, PROGRAM === "dsd" ? s.r : null, false);
};

$("btnManualGo").onclick = () => {
  const name = $("staffName").value.trim();
  if (name.length < 3 || !name.includes(" ")) { alert("Please enter your full name (first and last)."); return; }
  const role = PROGRAM === "dsd" ? $("role").value : null;
  identityChosen(name, role, true);
};

// ---- Review screen ----
function showReview() {
  const m = state.module;
  $("reviewMonth").textContent = moduleMonthName(m) + " In-Service";
  $("reviewTitle").textContent = m.title;
  const vb = $("videoBlock");
  vb.innerHTML = "";
  (m.videos || []).forEach(v => {
    const d = document.createElement("div");
    d.className = "video-embed";
    d.innerHTML = `<div class="video-title">▶ ${escapeHtml(v.title)}</div>` +
      `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(v.id)}" title="${escapeHtml(v.title)}" allowfullscreen loading="lazy"></iframe>`;
    vb.appendChild(d);
  });
  const ul = $("keyPoints");
  ul.innerHTML = "";
  const points = m.keyPoints || m.guidelines || [];
  points.forEach(k => {
    const li = document.createElement("li");
    li.textContent = k;
    ul.appendChild(li);
  });
  show("review");
}

$("btnBackToStart").onclick = () => show("start");
$("btnBeginQuiz").onclick = () => {
  state.qIndex = 0;
  state.answers = [];
  state.submitting = false;
  renderQuestion();
  show("quiz");
};

// ---- Quiz flow ----
function renderQuestion() {
  const qs = questionsFor(state.module, state.roleKey);
  const q = qs[state.qIndex];
  $("progressBar").style.width = Math.round((state.qIndex / qs.length) * 100) + "%";
  $("qCount").textContent = `Question ${state.qIndex + 1} of ${qs.length}`;
  $("qText").textContent = q.q;
  const box = $("choices");
  box.innerHTML = "";
  q.c.forEach((choice, i) => {
    const b = document.createElement("button");
    b.textContent = choice;
    b.onclick = () => {
      if (state.submitting) return;
      // prevent double-taps from registering twice
      box.querySelectorAll("button").forEach(x => x.disabled = true);
      state.answers.push(i);
      if (state.qIndex + 1 < qs.length) {
        state.qIndex++;
        renderQuestion();
      } else {
        finishQuiz();
      }
    };
    box.appendChild(b);
  });
}

// ---- Grade, sign (on pass), submit ----
function finishQuiz() {
  const qs = questionsFor(state.module, state.roleKey);
  const wrong = [];
  qs.forEach((q, i) => { if (state.answers[i] !== q.a) wrong.push(i + 1); });
  const correct = qs.length - wrong.length;
  const scorePct = Math.round((correct / qs.length) * 1000) / 10;
  state.pending = { wrong, correct, total: qs.length, scorePct, passed: scorePct >= PASS_PCT };
  if (state.pending.passed) {
    initSigPad();
    show("signature");
  } else {
    submit(null);
  }
}

async function submit(signature) {
  if (state.submitting) return;
  state.submitting = true;
  show("saving");
  const p = state.pending;

  let attemptNumber = null, recorded = false;
  try {
    const r = await fetch(FUNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        program: PROGRAM,
        role: state.role || undefined,
        facility: state.facility,
        staff_name: state.name,
        module_number: moduleId(state.module),
        module_title: moduleLabel(state.module),
        score_pct: p.scorePct,
        correct_count: p.correct,
        total_questions: p.total,
        passed: p.passed,
        wrong_questions: p.wrong,
        signature: signature || undefined
      })
    });
    const data = await r.json();
    if (data.ok) { recorded = true; attemptNumber = data.attempt_number; }
  } catch (e) { /* offline or server issue — still show result */ }

  if (p.passed) passedSet.add(moduleId(state.module));
  renderResult(p, recorded, attemptNumber, signature);
}

// ---- Signature pad ----
let sigCtx = null, sigInk = false, sigDrawing = false;
function initSigPad() {
  const canvas = $("sigPad");
  const dpr = window.devicePixelRatio || 1;
  requestAnimationFrame(() => {
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 180;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    sigCtx = canvas.getContext("2d");
    sigCtx.scale(dpr, dpr);
    sigCtx.fillStyle = "#ffffff";
    sigCtx.fillRect(0, 0, w, h);
    sigCtx.strokeStyle = "#1a2733";
    sigCtx.lineWidth = 2.5;
    sigCtx.lineCap = "round";
    sigCtx.lineJoin = "round";
  });
  sigInk = false;
  $("btnSigSave").disabled = true;

  if (!canvas.dataset.wired) {
    canvas.dataset.wired = "1";
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      sigDrawing = true;
      const [x, y] = pos(e);
      sigCtx.beginPath();
      sigCtx.moveTo(x, y);
      sigCtx.lineTo(x + 0.1, y + 0.1);
      sigCtx.stroke();
      sigInk = true;
      $("btnSigSave").disabled = false;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!sigDrawing) return;
      e.preventDefault();
      const [x, y] = pos(e);
      sigCtx.lineTo(x, y);
      sigCtx.stroke();
    });
    const stop = () => { sigDrawing = false; };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
  }
}
$("btnSigClear").onclick = () => initSigPad();
$("btnSigSave").onclick = () => {
  if (!sigInk || state.submitting) return;
  submit($("sigPad").toDataURL("image/png"));
};
$("btnSigSkip").onclick = () => { if (!state.submitting) submit(null); };

// ---- Result ----
function renderResult(p, recorded, attemptNumber, signature) {
  const box = $("resultBox");
  const now = new Date();
  const dateStr = now.toLocaleDateString() + " " + now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (p.passed) {
    box.innerHTML = `
      <div class="result-icon">🎉</div>
      <div class="center"><span class="badge pass">PASSED — ${p.scorePct}%</span></div>
      <h2 class="center">Great job, ${escapeHtml(firstName(state.name))}!</h2>
      <p class="sub center">You passed this in-service quiz.${recorded ? " Your result has been recorded." : ""}</p>
      ${recorded ? "" : '<p class="sub center warn">⚠️ Your result could not be saved (no connection). Please show this screen to your supervisor.</p>'}
      <div class="cert">
        <b>Completion Record</b><br>
        Name: <b>${escapeHtml(state.name)}</b><br>
        ${state.role ? `Position: ${escapeHtml(state.role)}<br>` : ""}
        Community: ${escapeHtml(state.facility)}<br>
        In-service: ${escapeHtml(moduleLabel(state.module))}<br>
        Score: ${p.scorePct}% (${p.correct}/${p.total})${attemptNumber ? `<br>Attempt #${attemptNumber}` : ""}<br>
        Date: ${dateStr}<br>
        Signature: ${signature ? "" : "not captured"}
        ${signature ? `<img class="sig-preview" src="${signature}" alt="signature">` : ""}
      </div>
      <button id="btnBackToList" class="primary">Back to my in-services</button>`;
    $("btnBackToList").onclick = () => { renderList(); show("start"); };
  } else {
    box.innerHTML = `
      <div class="result-icon">📖</div>
      <div class="center"><span class="badge fail">NOT YET — ${p.scorePct}%</span></div>
      <h2 class="center">${p.correct} of ${p.total} correct</h2>
      <p class="sub center">You need ${PASS_PCT}% to pass. Review the key points and try again — you can retake the quiz as many times as you need.</p>
      <div class="wrong-list"><b>Questions to review:</b> #${p.wrong.join(", #")}</div>
      <button id="btnRetake" class="primary">Review key points & retake</button>`;
    $("btnRetake").onclick = () => showReview();
  }
  show("result");
}

function firstName(n) { return n.split(" ")[0]; }

// ---- init ----
async function init() {
  brand();
  populateManualRoles();
  await loadFacilities();
  // Restore returning staff straight to their checklist
  const fac = lsGet("dq_fac"), name = lsGet("dq_name"), role = lsGet("dq_role");
  if (fac && name && [...$("facility").options].some(o => o.value === fac)) {
    $("facility").value = fac;
    state.facility = fac;
    await loadRoster(fac);
    const idx = roster.findIndex(s => s.n.toLowerCase() === name.toLowerCase());
    if (idx >= 0) {
      $("staffSelect").value = String(idx);
      identityChosen(roster[idx].n, PROGRAM === "dsd" ? roster[idx].r : null, false);
    } else if (lsGet("dq_manual")) {
      $("staffSelect").value = "__manual";
      $("manualBlock").style.display = "";
      $("roleBlock").style.display = PROGRAM === "dsd" ? "" : "none";
      $("staffName").value = name;
      if (PROGRAM === "dsd" && role) $("role").value = role;
    }
  }
}
init();
