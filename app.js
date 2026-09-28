/* ============================================================
   ministat — UI: data grid, analysis controller, report, plotting
   Statistics live in stats.js (window.Stats).
   ============================================================ */
"use strict";
const S = window.Stats;
const { fmt, fmtP, starsFor } = S;
/* "= 0.0123" or "< 0.0001" — for inline "P …" text */
const pRel = (p) => { const t = fmtP(p); return t.startsWith("<") ? t : "= " + t; };
const $ = (id) => document.getElementById(id);

/* ============================================================
   THEMES
   ============================================================ */
// Light-mode themes (white graph paper). Lines/fonts are dark for contrast.
const PAPER = "#ffffff", GRIDCOL = "#e5e7eb";
const THEMES = {
  prism:   { colors: ["#0173b2","#de8f05","#029e73","#d55e00","#cc78bc","#56b4e9","#949494","#fbafe4"], line:"#1f2937", markerLine:"#1f2937", paper:PAPER, font:"#1f2937" },
  pastel:  { colors: ["#7dd3fc","#fca5a5","#6ee7b7","#fcd34d","#c4b5fd","#f9a8d4","#67e8f9","#fdba74"], line:"#374151", markerLine:"#374151", paper:PAPER, font:"#374151" },
  vibrant: { colors: ["#2563eb","#dc2626","#16a34a","#eab308","#7c3aed","#db2777","#0891b2","#ea580c"], line:"#0f172a", markerLine:"#0f172a", paper:PAPER, font:"#0f172a" },
};

/* ============================================================
   STATE  +  PERSISTENCE  +  UNDO
   ============================================================ */
const DEMO = [
  { name: "Control",   values: [5.1, 4.8, 5.5, 4.9, 5.3, 5.0, 4.7, 5.2] },
  { name: "Treatment", values: [7.2, 6.9, 7.8, 7.1, 6.5, 7.4, 7.0, 6.8] },
];
const DEFAULT_ROWS = 10;
const STORE_KEY = "ministat:v1";
const SETTING_IDS = ["testSelect", "posthocSelect", "dunnAdj", "chartType", "errType", "themeSelect", "sigLabel", "xLabel", "yLabel", "plotW", "plotH", "dotSize"];
const GRAPH_DEFAULTS = { chartType: "bar", errType: "sem", themeSelect: "prism", sigLabel: "stars", xLabel: "Group", yLabel: "Value", plotW: "300", plotH: "400", dotSize: "6" };

let grid = [];          // array of groups: {name, cells:[string,...]}
let lastReport = null;  // report model of the most recent analysis (drives screen + TSV)
let lastPlot = null;    // plot spec of the most recent analysis (drives live re-styling)

function collectSettings() {
  const s = {};
  SETTING_IDS.forEach(id => { s[id] = $(id).value; });
  s.welchChk = $("welchChk").checked;
  return s;
}
function applySettings(s) {
  if (!s) return;
  SETTING_IDS.forEach(id => {
    if (s[id] == null) return;
    const el = $(id);
    // ignore values a <select> doesn't offer (e.g. from an older/newer file)
    if (el.tagName === "SELECT" && ![...el.options].some(o => o.value === String(s[id]))) return;
    el.value = s[id];
  });
  if (typeof s.welchChk === "boolean") $("welchChk").checked = s.welchChk;
  syncTestOptions();
}
function sanitizeGrid(g) {
  return g.map((c, i) => ({ name: String(c && c.name != null ? c.name : groupLabel(i)),
                            cells: (c && Array.isArray(c.cells) ? c.cells : []).map(v => String(v ?? "")) }));
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ grid, settings: collectSettings() })); } catch (e) { /* storage unavailable */ }
  }, 300);
}
function loadSaved() {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

const undoStack = [], redoStack = [];
const snapshot = () => JSON.stringify(grid);
let editSnapshot = null;   // grid state when a grid field gained focus → one undo step per edit
/* record any pending in-cell edit as its own undo step */
function commitEdit() {
  if (editSnapshot && editSnapshot !== snapshot()) pushHistory(editSnapshot);
  editSnapshot = null;
}
function pushHistory(snap) {
  if (snap === undefined) { commitEdit(); snap = snapshot(); }
  if (undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}
function restore(from, to) {
  if (!from.length) return;
  to.push(snapshot());
  grid = JSON.parse(from.pop());
  renderGrid(); scheduleSave(); updateHistoryButtons();
}
const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);
function updateHistoryButtons() { $("undoBtn").disabled = !undoStack.length; $("redoBtn").disabled = !redoStack.length; }
/* structural edit: snapshot → change → re-render → save */
function mutate(fn) { pushHistory(); fn(); renderGrid(); scheduleSave(); }

/* ============================================================
   DATA GRID
   ============================================================ */
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const groupLabel = (i) => "Group " + (i < 26 ? LETTERS[i] : i + 1);
function nextGroupName() {
  const used = new Set(grid.map(g => g.name));
  for (let i = grid.length; ; i++) if (!used.has(groupLabel(i))) return groupLabel(i);
}
const nRows = () => (grid.length ? Math.max(...grid.map(g => g.cells.length)) : 0);
const isBad = (v) => v.trim() !== "" && !isFinite(S.parseNum(v));
const looksLikeHeader = (row) => row.some(c => /[a-z]/i.test(c)) && row.every(c => c.trim() === "" || !isFinite(S.parseNum(c)));

function seedFromDemo() {
  const maxLen = Math.max(...DEMO.map(g => g.values.length));
  grid = DEMO.map(g => ({ name: g.name, cells: Array.from({ length: maxLen }, (_, i) => (g.values[i] != null ? String(g.values[i]) : "")) }));
  renderGrid();
}
function seedBlank() {
  grid = [
    { name: groupLabel(0), cells: Array(DEFAULT_ROWS).fill("") },
    { name: groupLabel(1), cells: Array(DEFAULT_ROWS).fill("") },
  ];
  renderGrid();
}

function renderGrid() {
  const rows = nRows();
  grid.forEach(g => { while (g.cells.length < rows) g.cells.push(""); });
  let html = "<thead><tr><th style='width:34px'></th>";
  grid.forEach((g, gi) => {
    html += `<th style="width:118px"><div class="relative">
        <input class="grp-name" data-g="${gi}" value="${escapeHtml(g.name)}" aria-label="Name of group ${gi + 1}" />
        ${grid.length > 1 ? `<button class="delGrp" data-g="${gi}" title="Delete group" aria-label="Delete group ${escapeHtml(g.name)}">×</button>` : ""}
      </div></th>`;
  });
  html += "</tr></thead><tbody>";
  for (let r = 0; r < rows; r++) {
    html += `<tr><td class="rowhdr"><span class="rn">${r + 1}</span><button class="delRow" data-r="${r}" title="Delete row ${r + 1}" aria-label="Delete row ${r + 1}">×</button></td>`;
    grid.forEach((g, gi) => {
      const v = g.cells[r];
      html += `<td><input class="cell-input${isBad(v) ? " bad" : ""}" data-g="${gi}" data-r="${r}" value="${escapeHtml(v)}" aria-label="${escapeHtml(g.name)}, row ${r + 1}" inputmode="decimal" /></td>`;
    });
    html += "</tr>";
  }
  $("dataTable").innerHTML = html + "</tbody>";
}

function focusCell(g, r) {
  const el = $("dataTable").querySelector(`.cell-input[data-g="${g}"][data-r="${r}"]`);
  if (el) { el.focus(); el.select(); }
}

/* --- all grid events are delegated to the table (one listener each) --- */
const table = $("dataTable");
table.addEventListener("focusin", e => {
  if (e.target.matches(".cell-input, .grp-name")) editSnapshot = snapshot();
});
table.addEventListener("change", () => { commitEdit(); editSnapshot = snapshot(); });
table.addEventListener("input", e => {
  const t = e.target, gi = +t.dataset.g;
  if (t.classList.contains("cell-input")) {
    grid[gi].cells[+t.dataset.r] = t.value;
    t.classList.toggle("bad", isBad(t.value));
  } else if (t.classList.contains("grp-name")) {
    grid[gi].name = t.value;
  }
  scheduleSave();
});
table.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.classList.contains("delRow")) mutate(() => grid.forEach(g => g.cells.splice(+b.dataset.r, 1)));
  else if (b.classList.contains("delGrp")) mutate(() => grid.splice(+b.dataset.g, 1));
});
table.addEventListener("paste", e => {
  if (e.target.classList.contains("cell-input")) onCellPaste(e, +e.target.dataset.g, +e.target.dataset.r);
});
table.addEventListener("keydown", e => {
  const t = e.target;
  if (t.classList.contains("grp-name")) {
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); focusCell(+t.dataset.g, 0); }
    return;
  }
  if (!t.classList.contains("cell-input")) return;
  const g = +t.dataset.g, r = +t.dataset.r;
  // ← → leave the cell at the text edge, or when the whole value is selected (just navigated in)
  const all = t.selectionStart === 0 && t.selectionEnd === t.value.length;
  const atStart = all || (t.selectionStart === 0 && t.selectionEnd === 0);
  const atEnd = all || (t.selectionStart === t.value.length && t.selectionEnd === t.value.length);
  let target = null;
  if (e.key === "Enter") {
    target = [g, e.shiftKey ? r - 1 : r + 1];
    if (!e.shiftKey && r + 1 >= nRows()) { commitEdit(); grid.forEach(gr => gr.cells.push("")); renderGrid(); scheduleSave(); }
  }
  else if (e.key === "ArrowDown") target = [g, r + 1];
  else if (e.key === "ArrowUp") target = [g, r - 1];
  else if (e.key === "ArrowLeft" && atStart) target = [g - 1, r];
  else if (e.key === "ArrowRight" && atEnd) target = [g + 1, r];
  else if (e.key === "Escape") { t.blur(); return; }
  if (!target) return;
  e.preventDefault();
  focusCell(target[0], target[1]);
});

/* Paste a block copied from Excel/Sheets directly into the grid, starting at
   the focused cell. Expands rows & groups as needed and detects a leading
   header row of group names on a paste into the first row. */
function onCellPaste(e, startG, startR) {
  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (!/[\t\n]/.test(text)) return; // single value → let the browser handle it
  e.preventDefault();
  let matrix = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n").map(l => l.split("\t"));
  mutate(() => {
    const width = Math.max(...matrix.map(r => r.length));
    while (grid.length < startG + width) grid.push({ name: nextGroupName(), cells: [] });
    if (startR === 0 && matrix.length > 1 && looksLikeHeader(matrix[0])) {
      matrix[0].forEach((nm, c) => { if (nm.trim()) grid[startG + c].name = nm.trim(); });
      matrix = matrix.slice(1);
    }
    const need = Math.max(startR + matrix.length, nRows());
    grid.forEach(g => { while (g.cells.length < need) g.cells.push(""); });
    matrix.forEach((row, r) => row.forEach((val, c) => { grid[startG + c].cells[startR + r] = String(val).trim(); }));
  });
}

function importPaste(text) {
  const rows = S.parseDelimited(text);
  if (!rows.length) return;
  mutate(() => {
    let names = [], dataRows = rows;
    if (looksLikeHeader(rows[0])) { names = rows[0]; dataRows = rows.slice(1); }
    const nCols = Math.max(...rows.map(r => r.length));
    grid = [];
    for (let c = 0; c < nCols; c++) grid.push({ name: names[c] || groupLabel(c), cells: dataRows.map(r => r[c] ?? "") });
    if (!dataRows.length) grid.forEach(g => g.cells.push(""));
  });
}

$("undoBtn").onclick = undo;
$("redoBtn").onclick = redo;
$("addRowBtn").onclick = () => mutate(() => {
  if (!grid.length) grid.push({ name: groupLabel(0), cells: [] });
  grid.forEach(g => g.cells.push(""));
});
$("addGroupBtn").onclick = () => mutate(() => grid.push({ name: nextGroupName(), cells: Array(nRows() || DEFAULT_ROWS).fill("") }));
$("clearBtn").onclick = () => {
  pushHistory();
  seedBlank();
  scheduleSave();
  $("pasteBox").value = "";
  clearResults();
  flash($("clearBtn"), "✓ Cleared — Undo restores");
};
$("importBtn").onclick = () => importPaste($("pasteBox").value);
$("loadDemoBtn").onclick = () => { pushHistory(); seedFromDemo(); scheduleSave(); $("pasteBox").value = ""; run(); };

document.addEventListener("keydown", e => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== "z" && k !== "y") return;
  // inside a text field, let the browser undo the typing itself
  const a = document.activeElement;
  if (a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "checkbox" && a.type !== "file"))) return;
  e.preventDefault();
  if (k === "y" || e.shiftKey) redo(); else undo();
});

/* ============================================================
   COLLECTING DATA
   ============================================================ */
function collectGroups() {
  const bad = [];
  const groups = grid.map((g, gi) => {
    const values = [], rows = [];
    g.cells.forEach((c, r) => {
      const t = String(c).trim();
      if (t === "") return;
      const n = S.parseNum(t);
      if (isFinite(n)) { values.push(n); rows.push(r); }
      else bad.push({ t, name: g.name || groupLabel(gi), r });
    });
    return { name: g.name.trim() || groupLabel(gi), values, rows };
  });
  const warns = bad.slice(0, 5).map(b => `“${b.t}” in ${b.name} (row ${b.r + 1}) is not a number — skipped.`);
  if (bad.length > 5) warns.push(`…and ${bad.length - 5} more non-numeric cells.`);
  const decimalComma = bad.some(b => /^[+-]?\d*,\d+$/.test(b.t));
  return { groups, warns, decimalComma };
}

/* rows where both groups have a value → matched pairs */
function pairUp(a, b) {
  const mb = new Map(b.rows.map((r, i) => [r, b.values[i]]));
  const x = [], y = [];
  a.rows.forEach((r, i) => { if (mb.has(r)) { x.push(a.values[i]); y.push(mb.get(r)); } });
  return { x, y, dropped: a.values.length + b.values.length - 2 * x.length };
}

function showWarnings(list, decimalComma) {
  const box = $("parseWarn");
  if (!list.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.innerHTML = list.map(p => "• " + escapeHtml(p)).join("<br>") +
    (decimalComma ? `<div class="mt-1.5"><button id="fixCommaBtn" class="tb-btn">Convert decimal commas (1,5 → 1.5)</button></div>` : "");
  box.classList.remove("hidden");
  if (decimalComma) $("fixCommaBtn").onclick = () => {
    mutate(() => grid.forEach(g => { g.cells = g.cells.map(c => /^\s*[+-]?\d*,\d+\s*$/.test(c) ? c.trim().replace(",", ".") : c); }));
    run();
  };
}

/* ============================================================
   CONTROLLER
   ============================================================ */
const TWO_GROUP = new Set(["ttest", "mwu", "paired", "wilcoxon"]);
function syncTestOptions() {
  const t = $("testSelect").value;
  $("opt_ttest").classList.toggle("hidden", t !== "ttest");
  $("opt_anova").classList.toggle("hidden", t !== "anova");
  $("opt_kruskal").classList.toggle("hidden", t !== "kruskal");
}
// analysis options: re-run immediately if results are already on screen
["testSelect", "posthocSelect", "dunnAdj", "welchChk"].forEach(id => $(id).addEventListener("change", () => {
  syncTestOptions(); scheduleSave();
  if (lastReport) run();
}));
// graph options: restyle the existing figure without recomputing statistics
["chartType", "errType", "themeSelect", "sigLabel"].forEach(id => $(id).addEventListener("change", () => { scheduleSave(); redraw(); }));
["xLabel", "yLabel", "dotSize"].forEach(id => $(id).addEventListener("input", () => { scheduleSave(); redraw(); }));
const redraw = () => { if (lastPlot) drawPlot(lastPlot); };

$("runBtn").onclick = run;
function run() {
  const { groups: raw, warns, decimalComma } = collectGroups();
  let groups = raw.filter(g => g.values.length > 0);
  const test = $("testSelect").value;
  const problems = [...warns];

  if (groups.length < 2) problems.push("Need at least 2 non-empty groups to run a test.");
  else if (TWO_GROUP.has(test) && groups.length > 2) {
    problems.push(`This test compares 2 groups — using “${groups[0].name}” and “${groups[1].name}”.`);
    groups = groups.slice(0, 2);
  }
  if (groups.length < 2) { showWarnings(problems, decimalComma); clearResults(); return; }

  const btn = $("runBtn"); btn.disabled = true; btn.textContent = "Analyzing…";
  setTimeout(() => {   // let the button repaint before a potentially slow post-hoc
    try {
      const res = ANALYSES[test](groups, problems);
      showWarnings(problems, decimalComma);
      if (!res) { clearResults(); return; }
      lastReport = res.report;
      verdictBox(res.verdict.sig, res.verdict.html);
      $("report").innerHTML = reportHtml(res.report);
      drawPlot(res.plot);
    } catch (err) {
      showWarnings(problems, decimalComma);
      $("report").innerHTML = `<div class="text-red-400 text-sm">Error: ${escapeHtml(err.message)}</div>`;
      console.error(err);
    } finally { btn.disabled = false; btn.textContent = "Analyze ▸"; }
  }, 20);
}

function clearResults() {
  $("verdict").innerHTML = "";
  $("report").innerHTML = "";
  lastReport = null; lastPlot = null;
  try { Plotly.purge("plot"); } catch (e) { /* nothing drawn yet */ }
}

/* ============================================================
   REPORT MODEL
   A report is { test, sections: [{ title, note?, head?, rows, extra? }] }.
   Cells are plain strings, or { sig: p } for a significance pill, or { b: text } for bold.
   The same model renders the on-screen tables and the copied TSV, so they can't drift.
   `extra` rows are included in the TSV but tucked behind "more" on screen.
   ============================================================ */
const sigCell = (p) => ({ sig: p });
const bold = (t) => ({ b: t });
const cellText = (c) => (c && typeof c === "object") ? ("sig" in c ? starsFor(c.sig) : c.b) : String(c);
function cellHtml(c) {
  if (c && typeof c === "object") {
    if ("sig" in c) return `<span class="pill ${c.sig < 0.05 ? "bg-emerald-500/15 text-emerald-300" : "bg-neutral-700 text-neutral-300"}">${starsFor(c.sig)}</span>`;
    return `<b>${escapeHtml(c.b)}</b>`;
  }
  return escapeHtml(c);
}
function tableHtml(head, rows, kv) {
  let h = `<table class="stat-table">`;
  if (head) h += `<thead><tr>${head.map((x, i) => `<th${i ? ' class="num"' : ""}>${escapeHtml(x)}</th>`).join("")}</tr></thead>`;
  h += "<tbody>" + rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? "num" : (kv ? "font-medium w-1/2" : "")}">${cellHtml(c)}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
  return h;
}
function reportHtml(rep) {
  return rep.sections.map(s => {
    let h = `<div><h3 class="h3">${escapeHtml(s.title)}${s.note ? ` <span class="text-xs font-normal text-neutral-400">${escapeHtml(s.note)}</span>` : ""}</h3>`;
    h += tableHtml(s.head, s.rows, !s.head);
    if (s.extra && s.extra.length) {
      h += `<details class="mt-1"><summary class="text-xs text-neutral-400 hover:text-neutral-200">More…</summary><div class="mt-1">${tableHtml(s.head, s.extra, !s.head)}</div></details>`;
    }
    if (s.hint) h += `<p class="mt-1 text-xs text-amber-300">${escapeHtml(s.hint)}</p>`;
    return h + "</div>";
  }).join("");
}
function reportTSV(rep) {
  const lines = ["Statistics report\t" + rep.test, ""];
  rep.sections.forEach(s => {
    lines.push(s.title + (s.note ? " " + s.note : ""));
    if (s.head) lines.push(s.head.join("\t"));
    [...s.rows, ...(s.extra || [])].forEach(r => lines.push(r.map(cellText).join("\t")));
    if (s.hint) lines.push(s.hint);
    lines.push("");
  });
  return lines.join("\n");
}

function verdictBox(yes, html) {
  const cls = yes ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-neutral-800 border-neutral-700 text-neutral-300";
  $("verdict").innerHTML = `<div class="border ${cls} rounded-lg px-4 py-3 text-sm font-medium">${html}</div>`;
}

/* ---- shared sections ---- */
function descSection(names, descs) {
  return {
    title: "Descriptive statistics", head: ["Statistic", ...names],
    rows: [
      ["N", ...descs.map(d => String(d.n))],
      ["Mean", ...descs.map(d => fmt(d.mean))],
      ["Std. Deviation", ...descs.map(d => fmt(d.sd))],
      ["Std. Error (SEM)", ...descs.map(d => fmt(d.sem))],
      ["Median", ...descs.map(d => fmt(d.median))],
    ],
    extra: [
      ["95% CI of mean", ...descs.map(d => `${fmt(d.ciLo)} to ${fmt(d.ciHi)}`)],
      ["Variance", ...descs.map(d => fmt(d.variance))],
      ["Minimum", ...descs.map(d => fmt(d.min))],
      ["Maximum", ...descs.map(d => fmt(d.max))],
      ["25% percentile (Q1)", ...descs.map(d => fmt(d.q1))],
      ["75% percentile (Q3)", ...descs.map(d => fmt(d.q3))],
      ["IQR", ...descs.map(d => fmt(d.iqr))],
    ],
  };
}

/* Normality (Shapiro–Wilk) for each sample, plus Brown–Forsythe when given
   independent groups. `parametric` decides whether failures produce a hint. */
function assumptionSection(samples, { variance, parametric, welch }) {
  const rows = [];
  let nonNormal = false, unequal = false;
  samples.forEach(s => {
    const sw = S.shapiroWilk(s.values);
    if (!sw) rows.push([`Normality (Shapiro–Wilk): ${s.name}`, "—", "—", s.values.length < 3 ? "n < 3, not tested" : "not tested"]);
    else {
      if (sw.p < 0.05) nonNormal = true;
      rows.push([`Normality (Shapiro–Wilk): ${s.name}`, "W = " + fmt(sw.W), fmtP(sw.p), sw.p < 0.05 ? "Not normal" : "Passed"]);
    }
  });
  if (variance && samples.every(s => s.values.length >= 2)) {
    const bf = S.brownForsythe(samples.map(s => s.values));
    if (bf.p < 0.05) unequal = true;
    rows.push(["Equal variances (Brown–Forsythe)", `F(${bf.df1}, ${bf.df2}) = ${fmt(bf.F, 3)}`, fmtP(bf.p), bf.p < 0.05 ? "Unequal" : "Passed"]);
  }
  const hints = [];
  if (parametric && nonNormal) hints.push("Normality is doubtful — consider the non-parametric alternative (especially with small n).");
  if (parametric && unequal && !welch) hints.push(welch === false ? "Variances differ — consider Welch's correction." : "Variances differ — interpret with care.");
  return { title: "Assumption checks", head: ["Check", "Statistic", "P", "Result"], rows, hint: hints.join(" ") || undefined };
}

const twoNames = (a, b) => `${a.name} − ${b.name}`;
const ciText = (ci) => ci ? `${fmt(ci[0])} to ${fmt(ci[1])}` : "—";

/* ============================================================
   ANALYSES  —  each returns { verdict, report, plot } (or null)
   ============================================================ */
const ANALYSES = {
  ttest(groups, problems) {
    const [a, b] = groups;
    const welch = $("welchChk").checked;
    if (a.values.length < 2 || b.values.length < 2) { problems.push("Each group needs at least 2 values for a t-test."); return null; }
    const r = S.tTest(a.values, b.values, welch);
    const name = `${welch ? "Welch's" : "Student's"} unpaired t-test`;
    return {
      verdict: { sig: r.p < 0.05, html: `Are the means significantly different? <b>${r.p < 0.05 ? "Yes" : "No"}</b> (${name}, <i>P</i> ${pRel(r.p)}, ${starsFor(r.p)}).` },
      report: { test: name, sections: [
        descSection([a.name, b.name], [r.A, r.B]),
        { title: name, rows: [
          [`Mean difference (${twoNames(a, b)})`, fmt(r.diff)],
          ["95% CI of difference", ciText(r.ci)],
          ["t", fmt(r.t)], ["df", fmt(r.df, 2)],
          ["P value (two-tailed)", bold(fmtP(r.p))],
          ["Significance", sigCell(r.p)],
        ], extra: [["Std. error of difference", fmt(r.se)]] },
        { title: "Effect size", rows: [["Cohen's d", fmt(r.d, 3)], ["Hedges' g", fmt(r.g, 3)]] },
        assumptionSection(groups, { variance: true, parametric: true, welch }),
      ] },
      plot: { groups, mode: "two", p: r.p },
    };
  },

  paired(groups, problems) {
    const [a, b] = groups;
    const pr = pairUp(a, b);
    if (pr.dropped) problems.push(`${pr.dropped} value(s) without a partner in the same row were excluded from the paired analysis.`);
    if (pr.x.length < 2) { problems.push("A paired test needs at least 2 rows with values in both groups."); return null; }
    const r = S.pairedTTest(pr.x, pr.y);
    const pg = [{ name: a.name, values: pr.x }, { name: b.name, values: pr.y }];
    return {
      verdict: { sig: r.p < 0.05, html: `Is the mean difference significantly different from zero? <b>${r.p < 0.05 ? "Yes" : "No"}</b> (paired t-test, <i>P</i> ${pRel(r.p)}, ${starsFor(r.p)}).` },
      report: { test: "Paired t-test", sections: [
        descSection([a.name, b.name], [r.A, r.B]),
        { title: "Paired t-test", rows: [
          ["Number of pairs", String(r.n)],
          [`Mean of differences (${twoNames(a, b)})`, fmt(r.diff)],
          ["95% CI of mean difference", ciText(r.ci)],
          ["SD of differences", fmt(r.D.sd)],
          ["t", fmt(r.t)], ["df", String(r.df)],
          ["P value (two-tailed)", bold(fmtP(r.p))],
          ["Significance", sigCell(r.p)],
        ], extra: [["Std. error of mean difference", fmt(r.se)]] },
        { title: "Effect size", rows: [["Cohen's dz (mean diff / SD of diffs)", fmt(r.dz, 3)]] },
        assumptionSection([{ name: "differences", values: pr.x.map((x, i) => x - pr.y[i]) }], { variance: false, parametric: true }),
      ] },
      plot: { groups: pg, mode: "two", p: r.p, paired: true },
    };
  },

  mwu(groups) {
    const [a, b] = groups;
    const r = S.mannWhitney(a.values, b.values);
    return {
      verdict: { sig: r.p < 0.05, html: `Are the distributions significantly different? <b>${r.p < 0.05 ? "Yes" : "No"}</b> (Mann–Whitney U, <i>P</i> ${pRel(r.p)}, ${starsFor(r.p)}).` },
      report: { test: "Mann-Whitney U", sections: [
        descSection([a.name, b.name], [r.A, r.B]),
        { title: "Mann–Whitney U / Wilcoxon rank-sum", rows: [
          ["U statistic", fmt(r.U, 1)],
          ["P value method", r.exact ? "Exact" : "Normal approx. (tie & continuity corrected)"],
          ...(r.exact ? [] : [["Z", fmt(r.z)]]),
          ["P value (two-tailed)", bold(fmtP(r.p))],
          ["Significance", sigCell(r.p)],
        ], extra: [
          [`Sum of ranks (${a.name})`, fmt(r.R1, 1)], [`U (${a.name})`, fmt(r.U1, 1)], [`U (${b.name})`, fmt(r.U2, 1)],
        ] },
        { title: "Effect size", rows: [[`Rank-biserial r (+ ⇒ ${a.name} larger)`, fmt(r.r, 3)]] },
        assumptionSection(groups, { variance: false, parametric: false }),
      ] },
      plot: { groups, mode: "two", p: r.p },
    };
  },

  wilcoxon(groups, problems) {
    const [a, b] = groups;
    const pr = pairUp(a, b);
    if (pr.dropped) problems.push(`${pr.dropped} value(s) without a partner in the same row were excluded from the paired analysis.`);
    if (pr.x.length < 1) { problems.push("A paired test needs rows with values in both groups."); return null; }
    const r = S.wilcoxonSignedRank(pr.x, pr.y);
    if (r.zeros) problems.push(`${r.zeros} pair(s) with zero difference were dropped (Wilcoxon's method).`);
    const pg = [{ name: a.name, values: pr.x }, { name: b.name, values: pr.y }];
    return {
      verdict: { sig: r.p < 0.05, html: `Is the median difference significantly different from zero? <b>${r.p < 0.05 ? "Yes" : "No"}</b> (Wilcoxon signed-rank, <i>P</i> ${pRel(r.p)}, ${starsFor(r.p)}).` },
      report: { test: "Wilcoxon signed-rank", sections: [
        descSection([a.name, b.name], [r.A, r.B]),
        { title: "Wilcoxon matched-pairs signed-rank test", rows: [
          ["Number of pairs (non-zero)", `${r.nPairs} (${r.n})`],
          [`Median of differences (${twoNames(a, b)})`, fmt(r.D.median)],
          ["W+ (sum of positive ranks)", fmt(r.Wplus, 1)],
          ["W− (sum of negative ranks)", fmt(r.Wminus, 1)],
          ["P value method", r.exact ? "Exact" : "Normal approx. (tie & continuity corrected)"],
          ...(r.exact ? [] : [["Z", fmt(r.z)]]),
          ["P value (two-tailed)", bold(fmtP(r.p))],
          ["Significance", sigCell(r.p)],
        ] },
        { title: "Effect size", rows: [["Matched-pairs rank-biserial r", fmt(r.r, 3)]] },
      ] },
      plot: { groups: pg, mode: "two", p: r.p, paired: true },
    };
  },

  anova(groups, problems) {
    const vals = groups.map(g => g.values);
    const av = S.anova(vals);
    if (!(av.dfW >= 1) || !(av.msW > 0)) { problems.push("ANOVA needs replicate values with some within-group variation."); return null; }
    if (groups.some(g => g.values.length < 2)) problems.push("Some groups have only 1 value — their SD/SEM are undefined.");
    const method = $("posthocSelect").value;
    const pairs = S.anovaPosthoc(av, method);
    const names = groups.map(g => g.name);
    const METHOD_NAMES = { tukey: "Tukey's HSD", bonferroni: "Bonferroni", holm: "Holm", dunnett: `Dunnett (vs. ${names[0]})` };
    const sections = [
      descSection(names, av.desc),
      { title: "One-way ANOVA", head: ["Source", "SS", "df", "MS", "F", "P"], rows: [
        ["Between groups", fmt(av.ssB), String(av.dfB), fmt(av.msB), fmt(av.F, 3), bold(fmtP(av.p))],
        ["Within groups", fmt(av.ssW), String(av.dfW), fmt(av.msW), "—", "—"],
        ["Total", fmt(av.ssT), String(av.dfB + av.dfW), "—", "—", "—"],
      ] },
      { title: "Effect size", rows: [["η² (eta squared)", fmt(av.eta2, 3)], ["ω² (omega squared)", fmt(av.omega2, 3)]] },
      posthocSection(`Post-hoc comparisons — ${METHOD_NAMES[method]}`, pairs, names, "Mean diff.", method !== "holm"),
    ];
    let plot;
    if (method === "dunnett") plot = { groups, mode: "control", ps: [null, ...pairs.map(p => p.p)] };
    else {
      const letters = S.compactLetters(av.k, pairs, av.desc.map(d => d.mean));
      sections.push(cldSection(names, av.desc.map(d => fmt(d.mean)), "Mean", letters));
      plot = { groups, mode: "letters", letters };
    }
    sections.push(assumptionSection(groups, { variance: true, parametric: true }));
    return {
      verdict: { sig: av.p < 0.05, html: `Is there a significant difference among the ${av.k} group means? <b>${av.p < 0.05 ? "Yes" : "No"}</b> (One-way ANOVA, F(${av.dfB}, ${av.dfW}) = ${fmt(av.F, 3)}, <i>P</i> ${pRel(av.p)}).` },
      report: { test: "One-way ANOVA", sections },
      plot,
    };
  },

  kruskal(groups) {
    const kw = S.kruskalWallis(groups.map(g => g.values));
    const adj = $("dunnAdj").value;
    const pairs = S.dunnTest(kw, adj);
    const names = groups.map(g => g.name);
    const letters = S.compactLetters(kw.k, pairs, kw.meanRanks);
    return {
      verdict: { sig: kw.p < 0.05, html: `Is there a significant difference among the ${kw.k} groups? <b>${kw.p < 0.05 ? "Yes" : "No"}</b> (Kruskal–Wallis, H(${kw.df}) = ${fmt(kw.H, 3)}, <i>P</i> ${pRel(kw.p)}).` },
      report: { test: "Kruskal-Wallis", sections: [
        descSection(names, kw.desc),
        { title: "Kruskal–Wallis test", rows: [
          ["H (tie-corrected)", fmt(kw.H, 3)], ["df", String(kw.df)],
          ["P value (χ² approx.)", bold(fmtP(kw.p))], ["Significance", sigCell(kw.p)],
          ["ε² (epsilon squared)", fmt(kw.eps2, 3)],
        ] },
        posthocSection(`Dunn's multiple comparisons — ${adj === "holm" ? "Holm" : "Bonferroni"} adjusted`, pairs, names, "Mean rank diff.", false),
        cldSection(names, kw.meanRanks.map(m => fmt(m, 2)), "Mean rank", letters),
      ] },
      plot: { groups, mode: "letters", letters },
    };
  },
};

function posthocSection(title, pairs, names, diffLabel, withCI) {
  const head = ["Comparison", diffLabel, ...(withCI ? ["95% CI (simultaneous)"] : []), "Adj. P", "Sig."];
  const rows = pairs.map(pr => [
    `${names[pr.i]} vs ${names[pr.j]}`, fmt(pr.diff), ...(withCI ? [ciText(pr.ci)] : []), fmtP(pr.p), sigCell(pr.p),
  ]);
  return { title, head, rows };
}
function cldSection(names, stat, statLabel, letters) {
  return { title: "Compact letter display", note: "(groups sharing a letter are not significantly different)",
           head: ["Group", statLabel, "Letters"], rows: names.map((n, i) => [n, stat[i], bold(letters[i])]) };
}

/* ============================================================
   PLOTTING
   spec: { groups:[{name, values}], mode: "two"|"letters"|"control",
           p?, letters?, ps? (per-group P vs control), paired? }
   ============================================================ */
/* small deterministic PRNG so jitter is identical on every redraw/export */
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawPlot(spec) {
  lastPlot = spec;
  const { groups } = spec;
  const theme = THEMES[$("themeSelect").value] || THEMES.prism;
  const errType = $("errType").value;
  const chartType = $("chartType").value;
  const dotSize = Math.max(2, parseInt($("dotSize").value, 10) || 6);
  const descs = groups.map(g => S.describe(g.values));
  const xIdx = groups.map((_, i) => i);
  const names = groups.map(g => g.name);
  const axisFont = { size: 14, family: "Arial, Helvetica, sans-serif" };
  // error-bar half-width; NaN (e.g. n = 1) → no bar, never poisons the axis range
  const errOf = (d) => {
    const e = errType === "sd" ? d.sd : errType === "ci" ? d.ciHi - d.mean : d.sem;
    return Number.isFinite(e) ? e : 0;
  };

  const traces = [];
  const layout = {
    paper_bgcolor: theme.paper, plot_bgcolor: theme.paper,
    font: { color: theme.font, family: "Arial, Helvetica, sans-serif", size: 13 },
    showlegend: false, margin: { t: 36, r: 20, b: 55, l: 60 },
    xaxis: { title: { text: $("xLabel").value, font: axisFont }, tickvals: xIdx, ticktext: names.map(escapeHtml),
             range: [-0.7, groups.length - 0.3], zeroline: false, showgrid: false,
             showline: true, mirror: true, linecolor: theme.line, linewidth: 1.5, ticks: "" },
    yaxis: { title: { text: $("yLabel").value, font: axisFont }, zeroline: false,
             gridcolor: GRIDCOL, showline: true, mirror: true, linecolor: theme.line, linewidth: 1.5, ticks: "" },
    annotations: [], shapes: [],
  };

  // top of each group's drawn elements (bar + error bar, whisker, and raw points)
  const tops = groups.map((g, i) => Math.max(...g.values, chartType === "bar" ? descs[i].mean + errOf(descs[i]) : -Infinity));
  let yMax = Math.max(...tops);
  let yMin = Math.min(...groups.map((g, i) => Math.min(...g.values, chartType === "bar" ? descs[i].mean - errOf(descs[i]) : Infinity)));

  if (chartType === "bar") {
    traces.push({
      type: "bar", x: xIdx, y: descs.map(d => d.mean),
      marker: { color: names.map((_, i) => theme.colors[i % theme.colors.length]), line: { color: theme.markerLine, width: 1.5 } },
      width: 0.6,
      error_y: { type: "data", array: descs.map(errOf), visible: true, color: theme.line, thickness: 1.6, width: 6 },
      customdata: names.map(escapeHtml),
      hovertemplate: "%{customdata}<br>mean %{y:.3f}<extra></extra>",
    });
  } else {
    groups.forEach((g, i) => {
      traces.push({
        type: "box", y: g.values, x: g.values.map(() => i),
        name: escapeHtml(g.name), boxpoints: false, width: 0.5,
        line: { color: theme.markerLine, width: 1.5 },
        fillcolor: theme.colors[i % theme.colors.length],
        marker: { color: theme.colors[i % theme.colors.length] },
        hoverinfo: "y",
      });
    });
  }

  // raw points — deterministic jitter (or exact x with connecting lines for paired data)
  if (spec.paired) {
    const [a, b] = groups;
    const xs = [], ys = [];
    a.values.forEach((v, j) => { xs.push(0, 1, null); ys.push(v, b.values[j], null); });
    traces.push({ type: "scatter", mode: "lines", x: xs, y: ys, line: { color: "rgba(0,0,0,0.35)", width: 1 }, hoverinfo: "skip" });
  }
  groups.forEach((g, i) => {
    const rnd = mulberry32(1009 * (i + 1));
    traces.push({
      type: "scatter", mode: "markers",
      x: g.values.map(() => spec.paired ? i : i + (rnd() - 0.5) * 0.28),
      y: g.values,
      marker: { color: "rgba(0,0,0,0)", size: dotSize, line: { color: "#000000", width: 1 } },
      text: g.values.map(() => escapeHtml(g.name)),
      hovertemplate: "%{text}<br>%{y:.3f}<extra></extra>",
      showlegend: false,
    });
  });

  const span = (yMax - yMin) || Math.abs(yMax) || 1;
  // Adaptive top padding so significance brackets / letters never overflow the frame.
  const sigPad = spec.mode === "two" ? 0.28 : 0.16;
  const lower = chartType === "bar" ? Math.min(0, yMin - span * 0.05) : yMin - span * 0.05;  // bars start at 0; boxes hug the data
  layout.yaxis.range = [lower, Math.max(yMax + span * sigPad, chartType === "bar" ? 0 : -Infinity)];

  const sigText = (p) => $("sigLabel").value === "pval" ? ("<i>P</i> " + pRel(p)) : starsFor(p);
  if (spec.mode === "letters") {
    tops.forEach((top, i) => layout.annotations.push({
      x: i, y: top + span * 0.04, text: "<b>" + escapeHtml(spec.letters[i]) + "</b>",
      showarrow: false, font: { size: 15, color: theme.font }, yanchor: "bottom",
    }));
  } else if (spec.mode === "control") {
    tops.forEach((top, i) => {
      if (i === 0) return;
      layout.annotations.push({ x: i, y: top + span * 0.04, text: sigText(spec.ps[i]), showarrow: false,
                                font: { size: 13, color: theme.font }, yanchor: "bottom" });
    });
  } else if (spec.mode === "two") {
    const yBar = yMax + span * 0.12, yLeg = yMax + span * 0.03;
    const line = { color: theme.line, width: 1.4 };
    layout.shapes.push(
      { type: "line", x0: 0, x1: 0, y0: yLeg, y1: yBar, line },
      { type: "line", x0: 1, x1: 1, y0: yLeg, y1: yBar, line },
      { type: "line", x0: 0, x1: 1, y0: yBar, y1: yBar, line },
    );
    layout.annotations.push({ x: 0.5, y: yBar, text: sigText(spec.p), showarrow: false, yanchor: "bottom", font: { size: 14, color: theme.font } });
  }

  setPlotBox();
  Plotly.newPlot("plot", traces, layout, { responsive: true, displayModeBar: false });
}

/* user-set width/height of the plot (blank width = full width) */
function plotSize() {
  const w = parseInt($("plotW").value, 10), h = parseInt($("plotH").value, 10);
  return { w: Number.isFinite(w) && w > 0 ? w : null, h: Number.isFinite(h) && h > 0 ? h : 400 };
}
function setPlotBox() {
  const el = $("plot"), { w, h } = plotSize();
  el.style.width = w ? w + "px" : "100%";
  el.style.height = h + "px";
  return el;
}
["plotW", "plotH"].forEach(id => $(id).addEventListener("input", () => {
  scheduleSave();
  const el = setPlotBox();
  if (el.data) Plotly.Plots.resize(el); // live resize without recomputing stats
}));

/* ============================================================
   EXPORT
   ============================================================ */
$("copyStats").onclick = async () => {
  if (!lastReport) { flash($("copyStats"), "Run a test first"); return; }
  try { await navigator.clipboard.writeText(reportTSV(lastReport)); flash($("copyStats"), "✓ Copied"); }
  catch { flash($("copyStats"), "Copy failed"); }
};
$("resetGraph").onclick = () => {
  Object.entries(GRAPH_DEFAULTS).forEach(([id, val]) => { $(id).value = val; });
  scheduleSave();
  if (lastPlot) drawPlot(lastPlot); // redraw at default options (also clears any zoom/pan)
  flash($("resetGraph"), "↺ Reset ✓");
};

// Exports keep the on-screen aspect ratio; PNG is rendered at 5× for print resolution.
function downloadPlot(format, btn) {
  if (!lastPlot) { flash(btn, "Run a test first"); return; }
  const el = $("plot");
  const w = plotSize().w || el.clientWidth || 700, h = plotSize().h;
  Plotly.downloadImage("plot", { format, width: w, height: h, scale: format === "png" ? 5 : 1, filename: "graph" });
}
$("dlPng").onclick = () => downloadPlot("png", $("dlPng"));
$("dlSvg").onclick = () => downloadPlot("svg", $("dlSvg"));

/* ============================================================
   SESSION EXPORT / IMPORT  (.jgz = gzip-compressed JSON)
   ============================================================ */
async function exportJH() {
  const payload = JSON.stringify({ app: "ministat", v: 3, savedAt: new Date().toISOString(), grid, settings: collectSettings(),
                                   report: lastReport ? reportTSV(lastReport) : "" });
  let blob;
  if (typeof CompressionStream !== "undefined") {
    const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream("gzip"));
    blob = await new Response(stream).blob();
  } else {
    blob = new Blob([payload], { type: "application/octet-stream" }); // uncompressed fallback
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "analysis-" + new Date().toISOString().slice(0, 10) + ".jgz";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readJH(file) {
  const buf = await file.arrayBuffer();
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    } catch (e) { /* not gzip → fall through to plain */ }
  }
  return JSON.parse(new TextDecoder().decode(buf)); // uncompressed fallback
}

$("exportBtn").onclick = () => exportJH().then(() => flash($("exportBtn"), "✓ Saved")).catch(err => alert("Export failed: " + err.message));

$("importJH").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = await readJH(file);
    if (!data || !Array.isArray(data.grid)) throw new Error("not a valid .jgz analysis file");
    pushHistory();
    grid = sanitizeGrid(data.grid);
    renderGrid();
    applySettings(data.settings);
    scheduleSave();
    run(); // re-runs analysis so results table + graph appear immediately
    flash($("importLabel"), "✓ Loaded");
  } catch (err) {
    alert("Could not import this file: " + err.message);
  }
  e.target.value = ""; // reset so the same file can be re-imported
};

function flash(btn, msg) {
  if (btn._flashTimer) clearTimeout(btn._flashTimer); else btn._flashOrig = btn.textContent;
  btn.textContent = msg;
  btn._flashTimer = setTimeout(() => { btn.textContent = btn._flashOrig; btn._flashTimer = null; }, 1400);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ============================================================
   INIT — restore the last session, or show the demo on a first visit
   ============================================================ */
(function init() {
  const saved = loadSaved();
  if (saved && Array.isArray(saved.grid) && saved.grid.length) {
    grid = sanitizeGrid(saved.grid);
    applySettings(saved.settings);
    renderGrid();
    if (collectGroups().groups.filter(g => g.values.length).length >= 2) run();
  } else {
    syncTestOptions();
    seedFromDemo();
    run();
  }
  updateHistoryButtons();
})();
