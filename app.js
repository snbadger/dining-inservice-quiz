// Dining Services In-Service Quiz — app logic
// Backend: Supabase Edge Function (records attempts + notifies the RD on pass)
const FUNC_URL = "https://pmnudshutxwidxdtouqj.supabase.co/functions/v1/dining-quiz";

const $ = (id) => document.getElementById(id);
const screens = ["start", "review", "quiz", "signature", "saving", "result"];
function show(name) {
  screens.forEach(s => $("screen-" + s).classList.toggle("active", s === name));
  window.scrollTo(0, 0);
}

let state = { module: null, qIndex: 0, answers: [], facility: "", name: "" };

// ---- Start screen setup ----
function populateModules() {
  const sel = $("module");
  sel.innerHTML = "";
  MODULES.forEach(m => {
    const o = document.createElement("option");
    o.value = m.n;
    o.textContent = `${m.month} — ${m.title}`;
    sel.appendChild(o);
  });
  sel.value = String(new Date().getMonth() + 1); // default to current month
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

$("btnStart").onclick = () => {
  const fac = $("facility").value.trim();
  const name = $("staffName").value.trim();
  if (!fac) { alert("Please select your community."); return; }
  if (name.length < 3 || !name.includes(" ")) { alert("Please enter your full name (first and last)."); return; }
  state.facility = fac;
  state.name = name;
  state.module = MODULES.find(m => m.n === Number($("module").value));
  showReview();
};

function showReview() {
  $("reviewMonth").textContent = state.module.month + " In-Service";
  $("reviewTitle").textContent = state.module.title;
  const ul = $("keyPoints");
  ul.innerHTML = "";
  state.module.keyPoints.forEach(k => {
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
  const qs = state.module.questions;
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
  const qs = state.module.questions;
  const wrong = [];
  qs.forEach((q, i) => { if (state.answers[i] !== q.a) wrong.push(i + 1); });
  const correct = qs.length - wrong.length;
  state.pending = {
    wrong,
    correct,
    total: qs.length,
    scorePct: Math.round((correct / qs.length) * 1000) / 10,
    passed: wrong.length === 0
  };
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
        facility: state.facility,
        staff_name: state.name,
        module_number: state.module.n,
        module_title: `${state.module.month} — ${state.module.title}`,
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

  renderResult(p.passed, p.scorePct, p.correct, p.total, p.wrong, recorded, attemptNumber, signature);
}

// ---- Signature pad ----
let sigCtx = null, sigInk = false, sigDrawing = false;
function initSigPad() {
  const canvas = $("sigPad");
  const dpr = window.devicePixelRatio || 1;
  // size the backing store once the element is laid out
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

function renderResult(passed, scorePct, correct, total, wrong, recorded, attemptNumber, signature) {
  const box = $("resultBox");
  const now = new Date();
  const dateStr = now.toLocaleDateString() + " " + now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (passed) {
    box.innerHTML = `
      <div class="result-icon">🎉</div>
      <div class="center"><span class="badge pass">PASSED — 100%</span></div>
      <h2 class="center">Great job, ${escapeHtml(firstName(state.name))}!</h2>
      <p class="sub center">You passed this month's in-service quiz.${recorded ? " Your result has been recorded and the Registered Dietitian has been notified." : ""}</p>
      ${recorded ? "" : '<p class="sub center warn">⚠️ Your result could not be saved (no connection). Please show this screen to your supervisor.</p>'}
      <div class="cert">
        <b>Completion Record</b><br>
        Name: <b>${escapeHtml(state.name)}</b><br>
        Community: ${escapeHtml(state.facility)}<br>
        In-service: ${escapeHtml(state.module.month)} — ${escapeHtml(state.module.title)}<br>
        Score: 100% (${correct}/${total})${attemptNumber ? `<br>Attempt #${attemptNumber}` : ""}<br>
        Date: ${dateStr}<br>
        Signature: ${signature ? "" : "not captured"}
        ${signature ? `<img class="sig-preview" src="${signature}" alt="signature">` : ""}
      </div>
      <button class="primary" onclick="location.reload()">Done</button>`;
  } else {
    box.innerHTML = `
      <div class="result-icon">📖</div>
      <div class="center"><span class="badge fail">NOT YET — ${scorePct}%</span></div>
      <h2 class="center">${correct} of ${total} correct</h2>
      <p class="sub center">You need 100% to pass. Review the key points and try again — you can retake the quiz as many times as you need.</p>
      <div class="wrong-list"><b>Questions to review:</b> #${wrong.join(", #")}</div>
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
populateModules();
loadFacilities();
