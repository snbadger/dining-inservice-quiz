// Staff In-Service Quiz — app logic
// Programs: 'dietary' (12 monthly modules, pass 100%) and 'dsd' (Yessi's calendar topics, pass 80%).
// Backend: Supabase Edge Function (records attempts + signatures; weekly report emails the owners)
const FUNC_URL = "https://pmnudshutxwidxdtouqj.supabase.co/functions/v1/dining-quiz";
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const PROGRAM = new URLSearchParams(location.search).get("p") === "dsd" ? "dsd" : "dietary";
const PASS_PCT = PROGRAM === "dsd" ? 80 : 100;
const PROGRAM_MODULES = PROGRAM === "dsd" ? DSD_MODULES : MODULES;

const $ = (id) => document.getElementById(id);
const screens = ["start", "review", "quiz", "signature", "saving", "result"];
function show(name) {
  screens.forEach(s => $("screen-" + s).classList.toggle("active", s === name));
  window.scrollTo(0, 0);
}

let state = { module: null, role: null, qIndex: 0, answers: [], facility: "", name: "", pending: null, submitting: false };

// ---- Program branding ----
function brand() {
  $("passPctLabel").textContent = PASS_PCT + "%";
  if (PROGRAM === "dsd") {
    $("brandIcon").textContent = "🩺";
    $("appTitle").innerHTML = "Staff In-Service Quiz";
    $("appSub").innerHTML = `Complete the quiz for this week's in-service. You must score <strong>${PASS_PCT}%</strong> or higher to pass — you can retake it as many times as you need.`;
    $("moduleLabel").textContent = "In-service topic";
    $("appFine").textContent = "Results are recorded automatically and reported to the DSD (Yessi Flores).";
    document.title = "Staff In-Service Quiz";
  }
}

// ---- Start screen setup ----
function moduleId(m) { return PROGRAM === "dsd" ? m.id : m.n; }
function moduleLabel(m) { return `${MONTH_NAMES[m.month - 1] ?? m.month} — ${m.title}`; }

function populateModules() {
  const sel = $("module");
  sel.innerHTML = "";
  PROGRAM_MODULES.forEach(m => {
    const o = document.createElement("option");
    o.value = moduleId(m);
    o.textContent = PROGRAM === "dsd" ? moduleLabel(m) : `${m.month} — ${m.title}`;
    sel.appendChild(o);
  });
  const nowMonth = new Date().getMonth() + 1;
  const def = PROGRAM_MODULES.find(m => (PROGRAM === "dsd" ? m.month === nowMonth : m.n === nowMonth));
  if (def) sel.value = String(moduleId(def));
  sel.onchange = updateRoleField;
  updateRoleField();
}

function currentModule() {
  const v = Number($("module").value);
  return PROGRAM_MODULES.find(m => moduleId(m) === v);
}

function updateRoleField() {
  const m = currentModule();
  const block = $("roleBlock");
  if (PROGRAM !== "dsd" || !m) { block.style.display = "none"; return; }
  const roles = Object.keys(m.roles);
  if (roles.length <= 1) { block.style.display = "none"; return; }
  block.style.display = "";
  const sel = $("role");
  sel.innerHTML = "";
  roles.forEach(r => {
    const o = document.createElement("option");
    o.value = r; o.textContent = r;
    sel.appendChild(o);
  });
  if (roles.includes("CNA")) {
    const o = document.createElement("option");
    o.value = "Other"; o.textContent = "Other / Non-nursing";
    sel.appendChild(o);
  }
}

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

// role label recorded + role key used for questions
function resolveRoleKey(m, displayRole) {
  if (PROGRAM !== "dsd") return null;
  const roles = Object.keys(m.roles);
  if (roles.length === 1) return roles[0];
  if (displayRole === "Other") return roles.includes("CNA") ? "CNA" : roles[0];
  return displayRole;
}

function questionsFor(m, roleKey) {
  return PROGRAM === "dsd" ? m.roles[roleKey] : m.questions;
}

$("btnStart").onclick = () => {
  const fac = $("facility").value.trim();
  const name = $("staffName").value.trim();
  if (!fac) { alert("Please select your community."); return; }
  if (name.length < 3 || !name.includes(" ")) { alert("Please enter your full name (first and last)."); return; }
  state.facility = fac;
  state.name = name;
  state.module = currentModule();
  const roles = PROGRAM === "dsd" ? Object.keys(state.module.roles) : [];
  state.role = PROGRAM === "dsd" ? (roles.length > 1 ? $("role").value : roles[0]) : null;
  state.roleKey = resolveRoleKey(state.module, state.role);
  showReview();
};

function showReview() {
  const m = state.module;
  $("reviewMonth").textContent = (MONTH_NAMES[m.month - 1] ?? m.month) + " In-Service";
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
      <button class="primary" onclick="location.reload()">Done</button>`;
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
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- init ----
brand();
populateModules();
loadFacilities();
