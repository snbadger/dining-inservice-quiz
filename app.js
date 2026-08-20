// Staff In-Service Quiz — app logic
// Programs: 'dietary' (12 monthly modules, pass 100%) and 'dsd' (Yessi's calendar topics, pass 80%).
// Flow: pick community -> pick yourself (Paycom roster; role derived from position) ->
// personal checklist shows only your role's in-services, with completed ones checked off.
// Backend: Supabase Edge Function (roster + progress + records attempts; weekly report emails the owners)
const FUNC_URL = "https://pmnudshutxwidxdtouqj.supabase.co/functions/v1/dining-quiz";
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// One merged checklist: the person's facility + role decides which programs they see.
// Everyone at Morning Star gets the DSD weekly topics; Dietary/Culinary staff (any
// building) also get the dietary monthly modules. ?p= links from old emails/QRs still
// land here and simply show the same merged list.
const DSD_FACILITY = "Morning Star Post Acute";
const passFor = (prog) => prog === "dsd" ? 80 : 100;
const modulesFor = (prog) => prog === "dsd" ? DSD_MODULES : MODULES;
const MANUAL_ROLES = ["CNA", "Licensed Nurse", "Dietary Aide", "All Staff"];
const MANUAL_ROLE_LABELS = { "CNA": "CNA / RNA", "Licensed Nurse": "Licensed Nurse (LVN / RN)", "Dietary Aide": "Dietary / Culinary", "All Staff": "Other / Non-nursing" };

const $ = (id) => document.getElementById(id);
const screens = ["start", "review", "quiz", "signature", "saving", "result"];
function show(name) {
  screens.forEach(s => $("screen-" + s).classList.toggle("active", s === name));
  window.scrollTo(0, 0);
}

let state = { prog: "dsd", module: null, role: null, qIndex: 0, answers: [], facility: "", name: "", pending: null, submitting: false };
let roster = [];                       // [{n, r}] for the selected facility
let passedSet = new Set();             // module ids this person has passed
let user = { name: "", role: "", manual: false };

function lsGet(k){ try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k,v){ try { localStorage.setItem(k,v); } catch (e) {} }

// ---- Branding (one neutral identity; each quiz shows its own pass score) ----
function brand() {
  $("brandIcon").textContent = "\u{1F4CB}";
  $("appTitle").innerHTML = "Staff In-Service Quiz";
  $("appSub").innerHTML = "Pick your name to see your in-services. Each quiz shows the score you need \u2014 you can retake as many times as you need.";
  $("appFine").textContent = "Results are recorded automatically and reported to the DSD (staff in-services) or the Registered Dietitian (dining program).";
  document.title = "Staff In-Service Quiz";
}

// ---- Module helpers ----
function moduleId(prog, m) { return prog === "dsd" ? m.id : m.n; }
function keyOf(prog, m) { return prog + ":" + moduleId(prog, m); }
function moduleMonthName(prog, m) {
  return prog === "dsd" ? (MONTH_NAMES[m.month - 1] ?? String(m.month)) : String(m.month);
}
function moduleLabel(prog, m) { return `${moduleMonthName(prog, m)} — ${m.title}`; }
// Every assigned topic is shown to everyone; the role only picks which question set
// they get (non-nursing falls back to the CNA set, matching the pre-checklist app).
function roleKeyFor(prog, m, role) {
  if (prog !== "dsd") return null;
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
function inWindow(prog, m) {
  const [cur, prev] = windowMonths();
  if (prog === "dsd") {
    const d = assignedMap ? assignedMap.get(m.id) : null;
    if (!d) return false;
    const mo = Number(String(d).slice(5, 7));
    return mo === cur || mo === prev;
  }
  const mo = MONTH_NAMES.indexOf(m.month) + 1;
  return mo === cur || mo === prev;
}
// sortable recency: dsd = actual send date; dietary = first of the module's month
function sortDateFor(prog, m) {
  if (prog === "dsd") return String(assignedMap.get(m.id) || "");
  const mo = MONTH_NAMES.indexOf(m.month) + 1;
  const now = new Date();
  let y = now.getFullYear();
  if (now.getMonth() + 1 === 1 && mo === 12) y -= 1;   // December shown in January's window
  return `${y}-${String(mo).padStart(2, "0")}-01`;
}
function questionsFor(prog, m, roleKey) {
  return prog === "dsd" ? m.roles[roleKey] : m.questions;
}
// Which programs this person sees: MS staff -> dsd; dietary/culinary role -> + dietary.
function programsFor() {
  const list = [];
  if (state.facility === DSD_FACILITY) list.push("dsd");
  if (user.role === "Dietary Aide") list.push("dietary");
  if (!list.length) list.push("dietary");   // other buildings: dietary program only
  return list;
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
let assignedMap = new Map();          // dsd module id -> send_date
let passedByProg = { dsd: new Set(), dietary: new Set() };
async function loadProgress() {
  passedByProg = { dsd: new Set(), dietary: new Set() };
  assignedMap = new Map();
  const progs = programsFor();
  const jobs = progs.map(p =>
    fetch(FUNC_URL + "?progress=1&program=" + p +
      "&facility=" + encodeURIComponent(state.facility) +
      "&staff_name=" + encodeURIComponent(user.name))
      .then(r => r.json()).then(d => ({ p, d })).catch(() => ({ p, d: {} }))
  );
  if (progs.includes("dsd")) {
    jobs.push(fetch(FUNC_URL + "?assigned=1&program=dsd").then(r => r.json())
      .then(d => ({ p: "_assigned", d })).catch(() => ({ p: "_assigned", d: {} })));
  }
  const results = await Promise.all(jobs);
  for (const { p, d } of results) {
    if (p === "_assigned") (d && d.assigned || []).forEach(a => assignedMap.set(a.m, a.d));
    else (d && d.passed || []).forEach(n => passedByProg[p].add(n));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderList() {
  $("manualBlock").style.display = "none";
  $("listBlock").style.display = "";
  const roleNote = " · " + (MANUAL_ROLE_LABELS[user.role] || user.role);
  $("listWho").textContent = user.name + roleNote;

  // merged entries across the person's programs, 2-month window, newest first
  const entries = [];
  for (const prog of programsFor()) {
    for (const m of modulesFor(prog)) {
      if (inWindow(prog, m)) entries.push({ prog, m, d: sortDateFor(prog, m) });
    }
  }
  entries.sort((a, b) => b.d.localeCompare(a.d));
  const isPassed = (e) => passedByProg[e.prog].has(moduleId(e.prog, e.m));
  const todo = entries.filter(e => !isPassed(e));
  const done = entries.filter(isPassed);
  const newestKey = entries.length ? entries[0].d : null;

  const row = (e, isDone) => {
    const cur = !isDone && e.d === newestKey;
    return `<button class="mod-row${isDone ? " done" : ""}${cur ? " now" : ""}" data-key="${keyOf(e.prog, e.m)}">` +
      `<span class="mod-ic">${isDone ? "✅" : "▶"}</span>` +
      `<span class="mod-t"><span class="mod-m">${escapeHtml(moduleMonthName(e.prog, e.m))}${e.prog === "dietary" ? " · Dining" : ""}</span>${escapeHtml(e.m.title)}</span>` +
      (cur ? '<span class="chip">Latest</span>' : "") +
      `</button>`;
  };

  $("todoList").innerHTML = todo.length
    ? todo.map(e => row(e, false)).join("")
    : `<div id="allDone">🎉 <b>All caught up${user.name ? ", " + escapeHtml(user.name.split(" ")[0]) : ""}!</b><br>You're current on your in-services for this month and last month.</div>`;

  const wrap = $("doneWrap");
  if (done.length) {
    wrap.style.display = "";
    $("doneSummary").textContent = `Completed ✓ (${done.length})`;
    $("doneList").innerHTML = done.map(e => row(e, true)).join("");
  } else {
    wrap.style.display = "none";
  }

  document.querySelectorAll(".mod-row").forEach(b => {
    b.onclick = () => startModule(b.dataset.key);
  });
}

function startModule(key) {
  const [prog, idStr] = String(key).split(":");
  const mid = Number(idStr);
  const m = modulesFor(prog).find(x => moduleId(prog, x) === mid);
  if (!m) return;
  state.prog = prog;
  state.module = m;
  state.name = user.name;
  state.role = prog === "dsd" ? user.role : null;
  state.roleKey = roleKeyFor(prog, m, user.role);
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
    $("roleBlock").style.display = "";
    $("staffName").focus();
    return;
  }
  $("manualBlock").style.display = "none";
  if (v === "") return;
  const s = roster[Number(v)];
  if (s) identityChosen(s.n, s.r, false);
};

$("btnManualGo").onclick = () => {
  const name = $("staffName").value.trim();
  if (name.length < 3 || !name.includes(" ")) { alert("Please enter your full name (first and last)."); return; }
  identityChosen(name, $("role").value, true);
};

// ---- Review screen ----
function showReview() {
  const m = state.module;
  $("reviewMonth").textContent = moduleMonthName(state.prog, m) + (state.prog === "dietary" ? " Dining In-Service" : " In-Service");
  $("reviewTitle").textContent = m.title;
  document.querySelector("#screen-review .sub").textContent =
    `Review these key points before your quiz — you need ${passFor(state.prog)}% to pass:`;
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
  const qs = questionsFor(state.prog, state.module, state.roleKey);
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
  const qs = questionsFor(state.prog, state.module, state.roleKey);
  const wrong = [];
  qs.forEach((q, i) => { if (state.answers[i] !== q.a) wrong.push(i + 1); });
  const correct = qs.length - wrong.length;
  const scorePct = Math.round((correct / qs.length) * 1000) / 10;
  state.pending = { wrong, correct, total: qs.length, scorePct, passed: scorePct >= passFor(state.prog) };
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
        program: state.prog,
        role: state.role || undefined,
        facility: state.facility,
        staff_name: state.name,
        module_number: moduleId(state.prog, state.module),
        module_title: moduleLabel(state.prog, state.module),
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

  if (p.passed) passedByProg[state.prog].add(moduleId(state.prog, state.module));
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
        In-service: ${escapeHtml(moduleLabel(state.prog, state.module))}<br>
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
      <p class="sub center">You need ${passFor(state.prog)}% to pass. Review the key points and try again — you can retake the quiz as many times as you need.</p>
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
      $("roleBlock").style.display = "";
      $("staffName").value = name;
      if (PROGRAM === "dsd" && role) $("role").value = role;
    }
  }
}
init();
