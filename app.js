/* ---------- 상수 ---------- */
const SUCCESS_COLOR = "#D4E157";
const FAIL_COLOR = "#5B6360";
const DEFAULT_ROTATION = [
  { id: "sq", group: "하체", name: "스쿼트", targetReps: 5, increment: 2.5, decrement: 5, startWeight: 90 },
  { id: "pu", group: "등", name: "풀업", targetReps: 20, increment: 2.5, decrement: 0, startWeight: 0 },
  { id: "ohp", group: "어깨", name: "오버헤드프레스", targetReps: 12, increment: 2.5, decrement: 5, startWeight: 45 },
  { id: "dl", group: "후면사슬", name: "데드리프트", targetReps: 5, increment: 2.5, decrement: 5, startWeight: 125 },
  { id: "bp", group: "가슴", name: "벤치프레스", targetReps: 12, increment: 2.5, decrement: 5, startWeight: 72.5 },
];

/* ---------- 유틸 ---------- */
function todayISO() { return new Date().toISOString().slice(0, 10); }
function uid() { return Math.random().toString(36).slice(2, 10); }
function round1(n) { return Math.round(n * 10) / 10; }
function fmt(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return Number(n).toFixed(digits).replace(/\.0$/, "");
}
function shortDate(iso) { const [, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}`; }
function weightLabel(w, unit) { return w === 0 ? "맨몸" : `${fmt(w)}${unit}`; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function loadKey(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function saveKey(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error("save failed", key, e); }
}

function computeSuggestion(weightLogs, iso, exName, targetReps, increment) {
  const logs = weightLogs
    .filter((w) => w.date < iso)
    .map((w) => ({ date: w.date, entry: (w.entries || []).find((e) => e.name === exName) }))
    .filter((x) => x.entry && x.entry.sets && x.entry.sets.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (logs.length === 0) return null;
  const last = logs[logs.length - 1];
  const firstSet = last.entry.sets[0];
  const success = firstSet.reps >= targetReps;
  const suggestedWeight = round1(success ? firstSet.weight + increment : firstSet.weight);
  let streak = 0;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (round1(logs[i].entry.sets[0].weight) === round1(firstSet.weight)) streak++;
    else break;
  }
  return { prevWeight: firstSet.weight, prevReps: firstSet.reps, success, suggestedWeight, streak, targetReps, date: last.date };
}
function computeCurrentExercise(rotation, weightLogs, iso) {
  if (!rotation || rotation.length === 0) return null;
  const todayLog = weightLogs.find((w) => w.date === iso);
  if (todayLog && todayLog.entries[0]) {
    const found = rotation.find((r) => r.name === todayLog.entries[0].name);
    if (found) return found;
  }
  const sorted = [...weightLogs].filter((w) => w.date !== iso).sort((a, b) => b.date.localeCompare(a.date));
  const lastLog = sorted[0];
  if (!lastLog || !lastLog.entries[0]) return rotation[0];
  const idx = rotation.findIndex((r) => r.name === lastLog.entries[0].name);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % rotation.length;
  return rotation[nextIdx];
}

/* ---------- 상태 ---------- */
const state = {
  tab: "today",
  unit: "kg",
  rotation: [],
  runLogs: [],
  weightLogs: [],
  activeDate: todayISO(),
  runForm: { distance: "", time: "", calories: "" },
  repsInputs: [],
  selectedExercise: "",
  newItem: { group: "", name: "", targetReps: "8", increment: "2.5", decrement: "5", startWeight: "" },
};
let runChart = null;
let exChart = null;

function loadFormsForActiveDate() {
  const iso = state.activeDate;
  const existingRun = state.runLogs.find((x) => x.date === iso);
  state.runForm = existingRun
    ? { distance: String(existingRun.distance ?? ""), time: String(existingRun.time ?? ""), calories: String(existingRun.calories ?? "") }
    : { distance: "", time: "", calories: "" };

  const cur = computeCurrentExercise(state.rotation, state.weightLogs, iso);
  const todayLog = state.weightLogs.find((x) => x.date === iso);
  if (cur && todayLog && todayLog.entries[0] && todayLog.entries[0].name === cur.name) {
    state.repsInputs = todayLog.entries[0].sets.map((s) => String(s.reps));
  } else {
    state.repsInputs = ["", "", "", ""];
  }
}

/* ---------- 초기화 ---------- */
function init() {
  state.rotation = loadKey("rotation", []);
  if (!state.rotation.length) {
    state.rotation = DEFAULT_ROTATION;
    saveKey("rotation", state.rotation);
  }
  state.runLogs = loadKey("running-logs", []);
  state.weightLogs = loadKey("weight-logs", []);
  state.unit = loadKey("unit-pref", "kg");
  state.activeDate = todayISO();
  loadFormsForActiveDate();

  const names = new Set();
  state.weightLogs.forEach((l) => l.entries.forEach((e) => names.add(e.name)));
  state.selectedExercise = Array.from(names)[0] || "";

  document.getElementById("app").addEventListener("click", handleClick);
  document.getElementById("app").addEventListener("input", handleInput);
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function flash(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ---------- 액션 ---------- */
function saveRun() {
  const iso = state.activeDate;
  const distance = parseFloat(state.runForm.distance);
  const time = parseFloat(state.runForm.time);
  const calories = parseFloat(state.runForm.calories);
  if (!distance && !time && !calories) { flash("기록할 값을 입력해줘"); return; }
  const entry = {
    id: uid(), date: iso,
    distance: Number.isFinite(distance) ? distance : 0,
    time: Number.isFinite(time) ? time : 0,
    calories: Number.isFinite(calories) ? calories : 0,
  };
  state.runLogs = [...state.runLogs.filter((x) => x.date !== iso), entry].sort((a, b) => a.date.localeCompare(b.date));
  saveKey("running-logs", state.runLogs);
  flash(`${shortDate(iso)} 러닝 기록 저장 완료`);
}

function getCurrentExercise() { return computeCurrentExercise(state.rotation, state.weightLogs, state.activeDate); }
function getSuggestionFor(ex) { return ex ? computeSuggestion(state.weightLogs, state.activeDate, ex.name, ex.targetReps, ex.increment) : null; }
function computeDerivedWeights(ex) {
  if (!ex) return [];
  const suggestion = getSuggestionFor(ex);
  let cur = suggestion ? suggestion.suggestedWeight : ex.startWeight;
  return state.repsInputs.map((repsStr) => {
    const w = round1(cur);
    const reps = parseInt(repsStr, 10);
    if (Number.isFinite(reps) && reps < ex.targetReps) cur = cur - ex.decrement;
    return w;
  });
}
function updateDerivedWeightsDOM() {
  const ex = getCurrentExercise();
  if (!ex) return;
  const weights = computeDerivedWeights(ex);
  document.querySelectorAll("[data-weight-readout]").forEach((el, i) => {
    el.textContent = weightLabel(weights[i], state.unit);
  });
}

function saveWeightSession() {
  const ex = getCurrentExercise();
  if (!ex) return;
  const weights = computeDerivedWeights(ex);
  const sets = state.repsInputs
    .map((r, i) => ({ reps: parseInt(r, 10), weight: weights[i] }))
    .filter((s) => Number.isFinite(s.reps));
  if (sets.length === 0) { flash("반복 횟수를 하나 이상 입력해줘"); return; }
  const iso = state.activeDate;
  const entry = { id: uid(), date: iso, entries: [{ name: ex.name, group: ex.group, sets }] };
  state.weightLogs = [...state.weightLogs.filter((x) => x.date !== iso), entry].sort((a, b) => a.date.localeCompare(b.date));
  saveKey("weight-logs", state.weightLogs);
  flash(`${shortDate(iso)} ${ex.name} 저장 완료`);
}

function deleteRunLog(id) {
  state.runLogs = state.runLogs.filter((r) => r.id !== id);
  saveKey("running-logs", state.runLogs);
  loadFormsForActiveDate();
}
function deleteWeightLog(id) {
  state.weightLogs = state.weightLogs.filter((w) => w.id !== id);
  saveKey("weight-logs", state.weightLogs);
  loadFormsForActiveDate();
}

function moveItem(id, dir) {
  const idx = state.rotation.findIndex((r) => r.id === id);
  const target = idx + dir;
  if (idx === -1 || target < 0 || target >= state.rotation.length) return;
  const next = [...state.rotation];
  [next[idx], next[target]] = [next[target], next[idx]];
  state.rotation = next;
  saveKey("rotation", state.rotation);
}
function removeItem(id) {
  state.rotation = state.rotation.filter((r) => r.id !== id);
  saveKey("rotation", state.rotation);
}
function addItem() {
  const name = state.newItem.name.trim();
  if (!name) return;
  const item = {
    id: uid(),
    group: state.newItem.group.trim() || name,
    name,
    targetReps: parseInt(state.newItem.targetReps, 10) || 8,
    increment: parseFloat(state.newItem.increment) || 2.5,
    decrement: parseFloat(state.newItem.decrement) || 0,
    startWeight: parseFloat(state.newItem.startWeight) || 0,
  };
  state.rotation = [...state.rotation, item];
  saveKey("rotation", state.rotation);
  state.newItem = { group: "", name: "", targetReps: "8", increment: "2.5", decrement: "5", startWeight: "" };
}

/* ---------- 이벤트 위임 ---------- */
function handleClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "set-tab") { state.tab = btn.dataset.tab; render(); }
  else if (action === "save-run") { saveRun(); render(); }
  else if (action === "save-weight") { saveWeightSession(); render(); }
  else if (action === "add-set") { state.repsInputs.push(""); render(); }
  else if (action === "toggle-unit") { state.unit = state.unit === "kg" ? "lbs" : "kg"; saveKey("unit-pref", state.unit); render(); }
  else if (action === "move-item") { moveItem(btn.dataset.id, parseInt(btn.dataset.dir, 10)); render(); }
  else if (action === "remove-item") { removeItem(btn.dataset.id); render(); }
  else if (action === "add-item") { addItem(); render(); }
  else if (action === "delete-run") { deleteRunLog(btn.dataset.id); render(); }
  else if (action === "delete-weight") { deleteWeightLog(btn.dataset.id); render(); }
  else if (action === "select-exercise") { state.selectedExercise = btn.dataset.name; render(); }
}
function handleInput(e) {
  const el = e.target;
  const bind = el.dataset.bind;
  if (!bind) return;
  if (bind === "activeDate") {
    state.activeDate = el.value || todayISO();
    loadFormsForActiveDate();
    render();
    return;
  }
  if (bind === "reps") {
    const idx = parseInt(el.dataset.idx, 10);
    state.repsInputs[idx] = el.value;
    updateDerivedWeightsDOM();
    return;
  }
  if (bind.startsWith("runForm.")) { state.runForm[bind.split(".")[1]] = el.value; return; }
  if (bind.startsWith("newItem.")) { state.newItem[bind.split(".")[1]] = el.value; return; }
  if (bind === "rotationField") {
    const item = state.rotation.find((r) => r.id === el.dataset.id);
    if (item) {
      const field = el.dataset.field;
      item[field] = (field === "group" || field === "name") ? el.value : (parseFloat(el.value) || 0);
      saveKey("rotation", state.rotation);
    }
  }
}

/* ---------- 렌더링 ---------- */
function render() {
  document.getElementById("big-date").innerHTML = `${new Date().getMonth() + 1}월 ${new Date().getDate()}일`;
  document.getElementById("run-count").textContent = state.runLogs.length;
  document.getElementById("weight-count").textContent = state.weightLogs.length;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));

  const content = document.getElementById("app-content");
  if (state.tab === "today") content.innerHTML = renderToday();
  else if (state.tab === "history") content.innerHTML = renderHistory();
  else if (state.tab === "progress") content.innerHTML = renderProgress();
  else content.innerHTML = renderSettings();

  if (state.tab === "progress") requestAnimationFrame(renderCharts);
}

function computeTotalSessions() {
  return state.runLogs.length + state.weightLogs.length;
}

function renderToday() {
  const ex = getCurrentExercise();
  const suggestion = getSuggestionFor(ex);
  const weights = computeDerivedWeights(ex);
  const unit = state.unit;

  let pm;
  if (!ex) {
    pm = `<div class="empty-note">로테이션에 운동이 없어. <b>설정</b> 탭에서 순서를 등록해줘.</div>`;
  } else {
    const suggestHtml = suggestion
      ? `<div class="suggest-note ${suggestion.success ? "ok" : "no"}">지난 ${esc(ex.name)} (${shortDate(suggestion.date)}): ${weightLabel(suggestion.prevWeight, unit)} ${suggestion.prevReps}회 ${suggestion.success ? "성공 ✓" : "실패"}${suggestion.success ? ` → 오늘 첫 세트 ${weightLabel(suggestion.suggestedWeight, unit)} 시작` : ` → 동일 중량 재도전 · ${suggestion.streak}번째 시도`}</div>`
      : `<div class="suggest-note no">첫 기록이야. 설정된 시작 중량 ${weightLabel(ex.startWeight, unit)}로 시작해.</div>`;

    const setsHtml = state.repsInputs.map((reps, idx) => `
      <div class="set-row">
        <span class="set-idx">${idx + 1}</span>
        <span class="weight-readout" data-weight-readout>${weightLabel(weights[idx], unit)}</span>
        <span class="set-x">×</span>
        <input class="set-input" type="number" inputmode="numeric" placeholder="회" value="${esc(reps)}" data-bind="reps" data-idx="${idx}" />
        ${idx === 0 ? '<span class="top-set-tag">TOP</span>' : ""}
      </div>`).join("");

    pm = `
      <div class="exercise-block">
        <div class="target-tag">목표 ${ex.targetReps}회 · 성공 시 +${ex.increment}${unit} · 실패 시 다음 세트 -${ex.decrement}${unit}</div>
        ${suggestHtml}
        ${setsHtml}
        <button class="add-set-btn" data-action="add-set">+ 세트 추가</button>
        <button class="save-btn pm" style="margin-top:10px" data-action="save-weight">✓ ${esc(ex.name)} 저장</button>
      </div>`;
  }

  return `
    <div class="date-row">
      <span class="date-row-label">기록할 날짜</span>
      <input type="date" class="date-input" value="${state.activeDate}" data-bind="activeDate" />
      ${state.activeDate !== todayISO() ? '<span class="date-badge">오늘 아님</span>' : ""}
    </div>
    <div class="section">
      <div class="section-title" style="border-color:var(--am)">☀️<span>AM · 러닝</span></div>
      <div class="input-row">
        <div class="labeled-input"><input type="number" inputmode="decimal" placeholder="0" value="${esc(state.runForm.distance)}" data-bind="runForm.distance" /><span class="input-label">거리 (km)</span></div>
        <div class="labeled-input"><input type="number" inputmode="decimal" placeholder="0" value="${esc(state.runForm.time)}" data-bind="runForm.time" /><span class="input-label">시간 (분)</span></div>
        <div class="labeled-input"><input type="number" inputmode="decimal" placeholder="0" value="${esc(state.runForm.calories)}" data-bind="runForm.calories" /><span class="input-label">칼로리 (kcal)</span></div>
      </div>
      <button class="save-btn am" data-action="save-run">✓ 러닝 저장</button>
    </div>
    <div class="section">
      <div class="section-title" style="border-color:var(--pm)">🌙<span>PM · ${ex ? esc(ex.group) + " · " + esc(ex.name) : "웨이트"}</span></div>
      ${pm}
    </div>`;
}

function renderHistory() {
  const targetMap = {};
  state.rotation.forEach((ex) => (targetMap[ex.name] = ex));

  const runRows = state.runLogs.length === 0
    ? `<div class="empty-note">아직 러닝 기록이 없어.</div>`
    : [...state.runLogs].reverse().map((r) => `
      <div class="history-row">
        <span class="history-date">${shortDate(r.date)}</span>
        <span class="history-detail">${fmt(r.distance)}km · ${fmt(r.time, 0)}분 · ${fmt(r.calories, 0)}kcal</span>
        <button class="icon-btn" data-action="delete-run" data-id="${r.id}">✕</button>
      </div>`).join("");

  const weightRows = state.weightLogs.length === 0
    ? `<div class="empty-note">아직 웨이트 기록이 없어.</div>`
    : [...state.weightLogs].reverse().map((w) => {
        const entries = w.entries.map((e) => {
          const target = targetMap[e.name];
          const firstSet = e.sets[0];
          const success = target && firstSet ? firstSet.reps >= target.targetReps : null;
          const tag = success === null ? "" : success ? `<span class="tag-success">성공</span>` : `<span class="tag-fail">실패</span>`;
          return `<div class="history-detail">${esc(e.name)}: ${e.sets.map((s) => `${weightLabel(s.weight, state.unit)}×${s.reps}`).join(", ")}${tag}</div>`;
        }).join("");
        return `<div class="history-block"><div class="history-row" style="border:none;padding-bottom:2px"><span class="history-date">${shortDate(w.date)} · ${esc(w.entries[0]?.group || "")}</span><button class="icon-btn" data-action="delete-weight" data-id="${w.id}">✕</button></div>${entries}</div>`;
      }).join("");

  return `
    <div class="plain-header">러닝 기록</div>${runRows}
    <div style="height:20px"></div>
    <div class="plain-header">웨이트 기록</div>${weightRows}`;
}

function renderProgress() {
  const bestDistance = state.runLogs.reduce((m, r) => Math.max(m, r.distance || 0), 0);
  const bestPace = state.runLogs.reduce((m, r) => {
    if (!r.distance || !r.time) return m;
    const p = r.time / r.distance;
    return m === null ? p : Math.min(m, p);
  }, null);
  const hasRunChart = state.runLogs.filter((r) => r.distance > 0).length > 1;

  const names = new Set();
  state.weightLogs.forEach((l) => l.entries.forEach((e) => names.add(e.name)));
  const exerciseNames = Array.from(names);
  if (!state.selectedExercise && exerciseNames.length) state.selectedExercise = exerciseNames[0];

  const targetMap = {};
  state.rotation.forEach((ex) => (targetMap[ex.name] = ex));

  const target = targetMap[state.selectedExercise];
  const exData = state.weightLogs.map((log) => {
    const e = log.entries.find((x) => x.name === state.selectedExercise);
    if (!e || e.sets.length === 0) return null;
    const maxWeight = Math.max(...e.sets.map((s) => s.weight));
    const firstSet = e.sets[0];
    const success = target ? firstSet.reps >= target.targetReps : null;
    return { date: log.date, label: shortDate(log.date), maxWeight, firstReps: firstSet.reps, success };
  }).filter(Boolean);
  const allBodyweight = exData.length > 0 && exData.every((d) => d.maxWeight === 0);
  const exercisePR = exData.reduce((m, d) => Math.max(m, d.maxWeight), 0);
  const bestReps = exData.reduce((m, d) => Math.max(m, d.firstReps), 0);

  const exerciseTabsHtml = exerciseNames.map((n) => `<button class="exercise-tab ${n === state.selectedExercise ? "active" : ""}" data-action="select-exercise" data-name="${esc(n)}">${esc(n)}</button>`).join("");

  return `
    <div class="plain-header">러닝 성장</div>
    <div class="stat-row">
      <div class="stat-card"><div class="stat-top">📍<span class="stat-label">최장 거리</span></div><div class="stat-value">${fmt(bestDistance)}km</div></div>
      <div class="stat-card"><div class="stat-top">⏱<span class="stat-label">최고 페이스</span></div><div class="stat-value">${bestPace ? fmt(bestPace) + "분/km" : "-"}</div></div>
    </div>
    ${hasRunChart ? `<div class="chart-box"><canvas id="run-chart" height="150"></canvas></div>` : `<div class="empty-note">러닝 기록이 2개 이상 쌓이면 그래프가 나타나.</div>`}
    <div style="height:24px"></div>
    <div class="plain-header">웨이트 성장</div>
    ${exerciseNames.length === 0 ? `<div class="empty-note">웨이트 세션을 저장하면 여기서 종목별 추이를 볼 수 있어.</div>` : `
      <div class="exercise-tabs">${exerciseTabsHtml}</div>
      <div class="stat-row">
        ${allBodyweight
          ? `<div class="stat-card"><div class="stat-top">📈<span class="stat-label">최고 반복 (맨몸)</span></div><div class="stat-value">${bestReps}회</div></div>`
          : `<div class="stat-card"><div class="stat-top">📈<span class="stat-label">개인 최고 중량</span></div><div class="stat-value">${weightLabel(exercisePR, state.unit)}</div></div>`}
        <div class="stat-card"><div class="stat-top">🏋️<span class="stat-label">기록 세션 수</span></div><div class="stat-value">${exData.length}회</div></div>
      </div>
      ${exData.length > 1 ? `
        <div class="chart-box"><canvas id="ex-chart" height="160"></canvas>
        <div class="legend-row"><span class="legend-item"><span class="legend-dot" style="background:${SUCCESS_COLOR}"></span>목표 성공</span><span class="legend-item"><span class="legend-dot" style="background:${FAIL_COLOR}"></span>실패</span></div></div>`
        : `<div class="empty-note">이 종목은 세션이 2개 이상 쌓이면 그래프가 나타나.</div>`}
    `}`;
}

function renderCharts() {
  const runCanvas = document.getElementById("run-chart");
  if (runCanvas) {
    if (runChart) runChart.destroy();
    const data = state.runLogs.filter((r) => r.distance > 0);
    runChart = new Chart(runCanvas, {
      type: "line",
      data: { labels: data.map((r) => shortDate(r.date)), datasets: [{ label: "거리(km)", data: data.map((r) => r.distance), borderColor: "#FF7A45", backgroundColor: "#FF7A45", tension: 0.3, pointRadius: 3 }] },
      options: chartOptions(),
    });
  }
  const exCanvas = document.getElementById("ex-chart");
  if (exCanvas) {
    if (exChart) exChart.destroy();
    const targetMap = {};
    state.rotation.forEach((ex) => (targetMap[ex.name] = ex));
    const target = targetMap[state.selectedExercise];
    const data = state.weightLogs.map((log) => {
      const e = log.entries.find((x) => x.name === state.selectedExercise);
      if (!e || e.sets.length === 0) return null;
      const maxWeight = Math.max(...e.sets.map((s) => s.weight));
      const firstSet = e.sets[0];
      const success = target ? firstSet.reps >= target.targetReps : null;
      return { date: log.date, maxWeight, firstReps: firstSet.reps, success };
    }).filter(Boolean);
    const allBodyweight = data.length > 0 && data.every((d) => d.maxWeight === 0);
    exChart = new Chart(exCanvas, {
      type: "line",
      data: {
        labels: data.map((d) => shortDate(d.date)),
        datasets: [{
          label: allBodyweight ? "첫세트 반복" : `최고중량(${state.unit})`,
          data: data.map((d) => (allBodyweight ? d.firstReps : d.maxWeight)),
          borderColor: "#7C8AFF",
          backgroundColor: data.map((d) => (d.success ? SUCCESS_COLOR : FAIL_COLOR)),
          pointBackgroundColor: data.map((d) => (d.success ? SUCCESS_COLOR : FAIL_COLOR)),
          pointRadius: 4,
          tension: 0.3,
        }],
      },
      options: chartOptions(),
    });
  }
}
function chartOptions() {
  return {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: "rgba(242,239,233,0.08)" }, ticks: { color: "#8B948F", font: { size: 10 } } },
      y: { grid: { color: "rgba(242,239,233,0.08)" }, ticks: { color: "#8B948F", font: { size: 10 } } },
    },
  };
}

function renderSettings() {
  const unit = state.unit;
  const rows = state.rotation.map((ex, i) => `
    <div class="day-block">
      <div class="day-block-head">
        <span class="day-label">${i + 1}. ${esc(ex.group)} · ${esc(ex.name)}</span>
        <div>
          <button class="icon-btn" data-action="move-item" data-id="${ex.id}" data-dir="-1">▲</button>
          <button class="icon-btn" data-action="move-item" data-id="${ex.id}" data-dir="1">▼</button>
          <button class="icon-btn" data-action="remove-item" data-id="${ex.id}">✕</button>
        </div>
      </div>
      <div class="input-row">
        <div class="labeled-input"><input type="number" value="${ex.targetReps}" data-bind="rotationField" data-id="${ex.id}" data-field="targetReps" /><span class="input-label">목표 회</span></div>
        <div class="labeled-input"><input type="number" value="${ex.increment}" data-bind="rotationField" data-id="${ex.id}" data-field="increment" /><span class="input-label">증량(${unit})</span></div>
        <div class="labeled-input"><input type="number" value="${ex.decrement}" data-bind="rotationField" data-id="${ex.id}" data-field="decrement" /><span class="input-label">실패감량(${unit})</span></div>
        <div class="labeled-input"><input type="number" value="${ex.startWeight}" data-bind="rotationField" data-id="${ex.id}" data-field="startWeight" /><span class="input-label">시작(${unit})</span></div>
      </div>
    </div>`).join("");

  return `
    <div class="plain-header">웨이트 로테이션 순서</div>
    <div class="empty-note">운동을 저장하면 다음번엔 이 순서의 다음 운동이 자동으로 떠. 시작 중량은 첫 기록 전까지만 쓰이고, 그 뒤엔 실제 기록 기반으로 자동 계산돼.</div>
    ${rows}
    <div class="day-block" style="margin-top:14px">
      <div class="day-label">운동 추가</div>
      <div class="input-row">
        <input class="text-input" style="flex:1" placeholder="부위 (예: 팔)" value="${esc(state.newItem.group)}" data-bind="newItem.group" />
        <input class="text-input" style="flex:1" placeholder="운동 이름" value="${esc(state.newItem.name)}" data-bind="newItem.name" />
      </div>
      <div class="input-row">
        <div class="labeled-input"><input type="number" value="${esc(state.newItem.targetReps)}" data-bind="newItem.targetReps" /><span class="input-label">목표 회</span></div>
        <div class="labeled-input"><input type="number" value="${esc(state.newItem.increment)}" data-bind="newItem.increment" /><span class="input-label">증량</span></div>
        <div class="labeled-input"><input type="number" value="${esc(state.newItem.decrement)}" data-bind="newItem.decrement" /><span class="input-label">실패감량</span></div>
        <div class="labeled-input"><input type="number" value="${esc(state.newItem.startWeight)}" data-bind="newItem.startWeight" /><span class="input-label">시작중량</span></div>
      </div>
      <button class="save-btn pr" data-action="add-item">+ 로테이션에 추가</button>
    </div>
    <div style="height:24px"></div>
    <div class="plain-header">단위</div>
    <button class="unit-btn" data-action="toggle-unit">현재 단위: <b style="margin-left:6px">${unit}</b><span class="hint">탭해서 변경</span></button>
  `;
}

init();
