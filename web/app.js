"use strict";

// ================================================================== state

const MAX_COMPARE = 6;
const CARD_PAGE = 48;
const DEFAULT_SORT = [{ key: "size", dir: -1 }];
const DEFAULT_SECTOR_MIN = 20;
// Min/max filter per numeric column: [min key, max key, value getter, kind]. Shared by the table
// header filters, the Filters panel and the tags.
const RANGES = {
  rsi: ["minSI", "maxSI", (f) => ret(f, "si"), "ret"],
  r1: ["min1", "max1", (f) => ret(f, "1y"), "ret"],
  r3: ["min3", "max3", (f) => ret(f, "3y"), "ret"],
  r5: ["min5", "max5", (f) => ret(f, "5y"), "ret"],
  r10: ["min10", "max10", (f) => ret(f, "10y"), "ret"],
  age: ["minAge", "maxAge", (f) => age(f), "years"],
  inception: ["minYear", "maxYear", (f) => (f.inception_date ? Number(f.inception_date.slice(0, 4)) : null), "year"],
  fee: ["minFee", "maxFee", (f) => f.expense_ratio, "pct"],
  size: ["minAum", "maxAum", (f) => (isNum(f.net_assets) ? f.net_assets / 1e6 : null), "musd"],
  yield: ["minYield", "maxYield", (f) => f.ttm_yield, "pct"],
};
const NUM_FILTERS = Object.values(RANGES).flatMap(([lo, hi]) => [lo, hi]);
const blankFilters = () => ({
  q: "", types: [], geos: [], sectors: [], sectorMin: DEFAULT_SECTOR_MIN, exps: [],
  ...Object.fromEntries(NUM_FILTERS.map((k) => [k, null])),
});
const S = { ...blankFilters(), basis: "nav", sort: structuredClone(DEFAULT_SORT), cmp: [], view: "table" };

let FUNDS = [];
let DIMS = {};            // exposure dimension -> sorted labels
let SECTOR_COMMON = [];   // sector labels used by many funds (shown as chips)
let META = {};
let cardsShown = CARD_PAGE;
let hiddenCols = new Set();
let drawerTicker = null;  // fund open in the drawer, so a language switch can re-render it

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = new Date();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

// ================================================================== language

let LANG = lsGet("fs.lang") || ((navigator.language || "").toLowerCase().startsWith("cs") ? "cs" : "en");
if (!I18N[LANG]) LANG = "en";
const L = () => I18N[LANG];
// t("key", ...args): string entries as is, function entries called with args; falls back to English.
function t(key, ...args) {
  const v = L()[key] ?? I18N.en[key];
  return typeof v === "function" ? v(...args) : v ?? key;
}
const typeName = (c) => L().types[c] || c || "—";
const regionName = (r) => L().regions[r] || r;
const sectorName = (s) => L().sectors[s] || s;
const dimName = (d) => L().dims[d] || d.replace(/\//g, " / ");
const labelName = (dim, l) => (dim === "region" ? regionName(l) : dim === "sector" ? sectorName(l) : l);

function applyStatic() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const k = el.dataset.i18n;
    el.textContent = k.startsWith("p_") ? L().period[k.slice(2)] : t(k);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  for (const [id, k] of [["lblH", "hours"], ["lblM", "minutes"], ["lblS", "seconds"]]) $(id).dataset.l = t(k);
  document.querySelectorAll("#langSeg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === LANG)));
  if (META.imported_at) $("snapshot").textContent = t("snapshot", META.imported_at.slice(0, 10));
}

function setLang(lang) {
  if (!I18N[lang] || lang === LANG) return;
  LANG = lang;
  lsSet("fs.lang", lang);
  applyStatic();
  renderColMenu();
  syncInputs();
  update();
  tickClock();
  if (!$("drawer").hidden && drawerTicker) openDrawer(drawerTicker);
  if (!$("compare").hidden) openCompare();
  if (popCol) openPop(popCol);
}
$("langSeg").addEventListener("click", (ev) => { const l = ev.target.closest("[data-lang]")?.dataset.lang; if (l) setLang(l); });

// ================================================================== number formatting

const isNum = (v) => v != null && Number.isFinite(v);
// Decimal comma and a space before % in Czech.
const dec = (s) => (LANG === "cs" ? s.replace(".", ",") : s);
const pctSign = (s) => (LANG === "cs" ? s + " %" : s + "%");
const fx = (v, d) => dec(v.toFixed(d));
function fmtPct(v, digits = 2) { return isNum(v) ? pctSign(fx(v, digits)) : "—"; }
const signed = (v, d) => (v >= 0 ? "+" : "−") + pctSign(fx(Math.abs(v), d));
function fmtRet(v, digits = 2) {
  if (!isNum(v)) return "—";
  return `<span class="${v >= 0 ? "pos" : "neg"}">${signed(v, digits)}</span>`;
}
function fmtBig(v) {
  if (!isNum(v)) return '<span class="muted">—</span>';
  return `<span class="${v < 0 ? "neg" : ""}">${signed(v, 1)}</span>`;
}
function fmtAum(v) {
  if (!isNum(v)) return "—";
  const [n, unit] = v >= 1e9 ? [fx(v / 1e9, v >= 1e11 ? 0 : 1), ["B", "mld."]] : v >= 1e6 ? [fx(v / 1e6, 0), ["M", "mil."]] : [String(Math.round(v / 1e3)), ["K", "tis."]];
  return LANG === "cs" ? `${n} ${unit[1]} $` : `$${n}${unit[0]}`;
}
function fmtAge(a, unit = true) {
  if (!isNum(a)) return "—";
  if (a < 1) return LANG === "cs" ? "< 1 rok" : "< 1 yr";
  return fx(a, 1) + (unit ? (LANG === "cs" ? " let" : " yrs") : "");
}
const fmtNum = (v) => dec(Number.isInteger(v) ? String(v) : String(+v.toFixed(2)));
function basisLabel() { return S.basis === "nav" ? t("basisNav") : t("basisPrice"); }

function age(f) {
  if (!f.inception_date) return null;
  return (today - new Date(f.inception_date)) / (365.25 * 864e5);
}
function ret(f, period) { return f[`${S.basis}_${period}`]; }
function expo(f, dim, label) {
  const row = (f.exposures[dim] || []).find(([l]) => l === label);
  return row ? row[1] : 0;
}

// Short "Europe 61% · Asia-Pac. 35%" style summary of an exposure list.
function expoSummary(list, dim, n = 2) {
  if (!list || !list.length) return null;
  const short = dim === "region" ? L().regionShort : L().sectorShort;
  return list.slice(0, n).map(([l, w]) => `${esc(short[l] || labelName(dim, l))} <b>${pctSign(fx(w, 0))}</b>`).join(" · ");
}

// ================================================================== vocab

const TYPE_KEYS = ["Equity", "Fixed Income", "Real Estate", "Commodity", "Digital Assets", "Multi Asset", "Cash"];
const GEO_TESTS = {
  na: (f) => f.primary_region === "North America",
  eu: (f) => f.primary_region === "Europe",
  ap: (f) => f.primary_region === "Asia Pacific",
  la: (f) => f.primary_region === "Latin America",
  mea: (f) => /Middle East|Kuwait/.test(f.primary_region || ""),
  gl: (f) => f.primary_region === "Global",
  em: (f) => f.market_type === "Emerging",
};

// ================================================================== columns + sorting

const COLUMNS = [
  { id: "etf", locked: true, sortKey: "ticker", sticky: true },
  { id: "rsi", unit: "ann", num: true, sortKey: "rsi", def: true, ret: "si" },
  { id: "age", unit: "yrs", num: true, sortKey: "age", def: true },
  { id: "inception", num: true, sortKey: "inception", def: true },
  { id: "r1", num: true, sortKey: "r1", ret: "1y" },
  { id: "r3", unit: "ann", num: true, sortKey: "r3", ret: "3y" },
  { id: "r5", unit: "ann", num: true, sortKey: "r5", def: true, ret: "5y" },
  { id: "r10", unit: "ann", num: true, sortKey: "r10", def: true, ret: "10y" },
  { id: "fee", num: true, sortKey: "fee", def: true },
  { id: "size", num: true, sortKey: "size" },
  { id: "type", sortKey: "type" },
  { id: "yield", unit: "m12", num: true, sortKey: "yield" },
  { id: "geo", def: true, expo: "region" },
  { id: "sector", def: true, expo: "sector" },
];
const colLabel = (c) => L().cols[c.id];
const colUnit = (c) => (c.unit ? L().units[c.unit] : "");

// Every sortable key: value getter and the direction a first click uses. Labels live in I18N.sorts.
const SORTS = {
  ticker: { get: (f) => f.ticker, dir: 1 },
  name: { get: (f) => f.name, dir: 1 },
  rsi: { get: (f) => ret(f, "si"), dir: -1 },
  r1: { get: (f) => ret(f, "1y"), dir: -1 },
  r3: { get: (f) => ret(f, "3y"), dir: -1 },
  r5: { get: (f) => ret(f, "5y"), dir: -1 },
  r10: { get: (f) => ret(f, "10y"), dir: -1 },
  age: { get: age, dir: -1 },
  inception: { get: (f) => f.inception_date, dir: 1 },
  fee: { get: (f) => f.expense_ratio, dir: 1 },
  size: { get: (f) => f.net_assets, dir: -1 },
  type: { get: (f) => typeName(f.asset_class), dir: 1 },
  yield: { get: (f) => f.ttm_yield, dir: -1 },
};
const sortLabel = (k) => L().sorts[k];
const dirWord = (key, dir) => {
  if (key === "inception") return dir === 1 ? t("oldestFirst") : t("newestFirst");
  if (["ticker", "name", "type"].includes(key)) return dir === 1 ? "A→Z" : "Z→A";
  return dir === 1 ? t("lowHigh") : t("highLow");
};

function visibleCols() { return COLUMNS.filter((c) => c.locked || !hiddenCols.has(c.id)); }

const REGION_CLASS = { "North America": "g-na", "Europe": "g-eu", "Asia Pacific": "g-ap", "Latin America": "g-la", "Middle East & Africa": "g-me" };

function retCell(v) {
  if (!isNum(v)) return "—";
  const w = Math.min(Math.abs(v) / 25, 1) * 72;      // 25%/yr fills the bar
  return `<span class="rc ${v >= 0 ? "pos" : "neg"}">${signed(v, 2)}<span class="bar" style="width:${w.toFixed(0)}px"></span></span>`;
}

function cellHtml(c, f, i) {
  switch (c.id) {
    case "etf": {
      const a = age(f), on = S.cmp.includes(f.ticker);
      return `<div class="etfcell">
        <span class="rank">${String(i + 1).padStart(2, "0")}</span>
        <input type="checkbox" data-cmp="${esc(f.ticker)}" ${on ? "checked" : ""} aria-label="${esc(t("compareT", f.ticker))}">
        <span class="tk">${esc(f.ticker)}</span>
        <span class="nm" title="${esc(f.description || f.name)}">${esc(f.name.replace(/^iShares /, ""))}${isNum(a) && a < 5 ? `<span class="badge" title="${esc(t("newTitle"))}">${esc(t("newBadge"))}</span>` : ""}</span>
      </div>`;
    }
    case "age": return fmtAge(age(f), false);
    case "inception": return esc(f.inception_date || "—");
    case "fee": return fmtPct(f.expense_ratio);
    case "size": return fmtAum(f.net_assets);
    case "type": return esc(typeName(f.asset_class));
    case "yield": return fmtPct(f.ttm_yield);
    case "geo": {
      const list = f.exposures.region;
      if (!list || !list.length) return "—";
      const full = list.map(([l, w]) => `${regionName(l)} ${pctSign(fx(w, 1))}`).join(", ");
      const segs = list.filter(([, w]) => w > 0).map(([l, w]) => `<span class="${REGION_CLASS[l] || "g-ot"}" style="width:${Math.min(w, 100)}%"></span>`).join("");
      return `<button class="expobtn geo" data-expo="region" title="${esc(full)} — ${esc(t("fullBreakdown"))}">
        <span class="geobar">${segs}</span><span>${expoSummary(list, "region")}</span></button>`;
    }
    case "sector": {
      const list = f.exposures.sector;
      const s = expoSummary(list, "sector");
      if (!s) return "—";
      const full = list.slice(0, 6).map(([l, w]) => `${sectorName(l)} ${pctSign(fx(w, 1))}`).join(", ");
      return `<button class="expobtn" data-expo="sector" title="${esc(full)} — ${esc(t("fullBreakdown"))}">${s}</button>`;
    }
    default: return c.ret ? retCell(ret(f, c.ret)) : "—";
  }
}

function isMissing(c, f) {
  if (c.ret) return !isNum(ret(f, c.ret));
  if (c.expo) return !(f.exposures[c.expo] || []).length;
  return false;
}

// ================================================================== URL state

// URL key -> state key. The first nine predate the table filters; keep them so old bookmarks work.
const URL_NUMS = {
  si: "minSI", six: "maxSI", r5: "min5", r5x: "max5", r10: "min10", r10x: "max10", age: "minAge", fee: "maxFee", aum: "minAum",
  r1: "min1", r1x: "max1", r3: "min3", r3x: "max3", agex: "maxAge", feen: "minFee", aumx: "maxAum", yr: "minYear", yrx: "maxYear",
  yl: "minYield", ylx: "maxYield",
};

function saveUrl() {
  const p = new URLSearchParams();
  if (S.q) p.set("q", S.q);
  if (S.types.length) p.set("a", S.types.join(","));
  if (S.geos.length) p.set("g", S.geos.join(","));
  if (S.sectors.length) p.set("sec", S.sectors.join(";"));
  if (S.sectors.length && S.sectorMin !== DEFAULT_SECTOR_MIN) p.set("sm", S.sectorMin);
  for (const [k, key] of Object.entries(URL_NUMS)) if (S[key] != null) p.set(k, S[key]);
  if (S.basis !== "nav") p.set("b", S.basis);
  if (S.exps.length) p.set("x", S.exps.map((e) => [e.dim, e.label, e.min ?? ""].join("|")).join(";"));
  const s = S.sort.map((r) => `${r.key}:${r.dir}`).join(",");
  if (s !== DEFAULT_SORT.map((r) => `${r.key}:${r.dir}`).join(",")) p.set("s", s);
  if (S.cmp.length) p.set("c", S.cmp.join(","));
  if (S.view !== "table") p.set("v", S.view);
  const qs = p.toString();
  history.replaceState(null, "", qs ? "#" + qs : location.pathname);
}

function loadUrl() {
  const p = new URLSearchParams(location.hash.slice(1));
  const list = (k, sep = ",") => (p.get(k) ? p.get(k).split(sep).filter(Boolean) : []);
  Object.assign(S, blankFilters());
  S.q = p.get("q") || "";
  S.types = list("a");
  S.geos = list("g").filter((g) => GEO_TESTS[g]);
  S.sectors = list("sec", ";");
  if (p.has("sm")) S.sectorMin = Number(p.get("sm"));
  for (const [k, key] of Object.entries(URL_NUMS)) S[key] = p.has(k) && p.get(k) !== "" && isNum(Number(p.get(k))) ? Number(p.get(k)) : null;
  S.basis = p.get("b") === "price" ? "price" : "nav";
  S.exps = list("x", ";").map((s) => {
    const [dim, label, min] = s.split("|");
    return { dim, label, min: min === "" || min == null ? null : Number(min) };
  });
  S.sort = list("s").map((s) => { const [key, d] = s.split(":"); return { key, dir: Number(d) === 1 ? 1 : -1 }; })
    .filter((r) => SORTS[r.key]);
  if (!S.sort.length) S.sort = structuredClone(DEFAULT_SORT);
  S.cmp = list("c");
  S.view = p.get("v") === "cards" ? "cards" : "table";
}

// ================================================================== filtering + sorting

function passes(f) {
  if (S.q) {
    const q = S.q.toLowerCase();
    if (![f.ticker, f.name, f.isin, f.cusip, f.description].some((v) => v && v.toLowerCase().includes(q))) return false;
  }
  // within a category: OR
  if (S.types.length && !S.types.includes(f.asset_class)) return false;
  if (S.geos.length && !S.geos.some((g) => GEO_TESTS[g](f))) return false;
  if (S.sectors.length && !S.sectors.some((s) => expo(f, "sector", s) >= (S.sectorMin ?? 0.0001))) return false;
  // across categories: AND
  for (const [lo, hi, get] of Object.values(RANGES)) {
    if (S[lo] == null && S[hi] == null) continue;
    const v = get(f);
    if (!isNum(v)) return false;          // missing data (e.g. no 10y history) never passes
    if (S[lo] != null && v < S[lo]) return false;
    if (S[hi] != null && v > S[hi]) return false;
  }
  for (const e of S.exps) if (expo(f, e.dim, e.label) < (e.min ?? 0.0001)) return false;
  return true;
}

function compareFunds(a, b) {
  for (const { key, dir } of S.sort) {
    const get = SORTS[key].get, va = get(a), vb = get(b);
    const ma = va == null || (typeof va === "number" && !isNum(va));
    const mb = vb == null || (typeof vb === "number" && !isNum(vb));
    if (ma && mb) continue;
    if (ma) return 1;                     // missing values always last, whatever the direction
    if (mb) return -1;
    const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    if (c) return c * dir;
  }
  return a.ticker.localeCompare(b.ticker);
}

// ================================================================== render: controls

function chipHtml(attr, value, label, on) {
  return `<button class="chip" data-${attr}="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
}

function renderFilterControls() {
  const present = new Set(FUNDS.map((f) => f.asset_class));
  $("fTypes").innerHTML = TYPE_KEYS.filter((v) => present.has(v)).map((v) => chipHtml("type", v, typeName(v), S.types.includes(v))).join("");
  $("fGeos").innerHTML = Object.keys(GEO_TESTS).map((k) => chipHtml("geo", k, L().geos[k], S.geos.includes(k))).join("");
  const chipSectors = [...new Set([...SECTOR_COMMON, ...S.sectors])];
  $("fSectors").innerHTML = chipSectors.map((s) => chipHtml("sector", s, sectorName(s), S.sectors.includes(s))).join("");
  $("moreSectors").innerHTML = `<option value="">${esc(t("moreSectors"))}</option>` +
    (DIMS.sector || []).filter((s) => !chipSectors.includes(s)).map((s) => `<option value="${esc(s)}">${esc(sectorName(s))}</option>`).join("");
  document.querySelectorAll("#basis button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === S.basis)));
  document.querySelectorAll("#viewSeg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === S.view)));
}

function syncInputs() {
  $("q").value = S.q;
  for (const k of NUM_FILTERS) if ($(k)) $(k).value = S[k] ?? "";
  $("sectorMin").value = S.sectorMin ?? "";
  renderFilterControls();
  renderExps();
}

function renderExps() {
  const dims = Object.keys(DIMS).sort((a, b) => (a === "region" ? -1 : b === "region" ? 1 : a.localeCompare(b)));
  $("exps").innerHTML = S.exps.map((e, i) => `
    <div class="exp" data-i="${i}">
      <select data-k="dim" aria-label="${esc(t("fExpo"))}">${dims.map((d) => `<option value="${esc(d)}" ${d === e.dim ? "selected" : ""}>${esc(dimName(d))}</option>`).join("")}</select>
      <select data-k="label" aria-label="${esc(dimName(e.dim))}">${(DIMS[e.dim] || []).map((l) => `<option value="${esc(l)}" ${l === e.label ? "selected" : ""}>${esc(labelName(e.dim, l))}</option>`).join("")}</select>
      <input data-k="min" type="number" min="0" max="100" step="1" value="${e.min ?? ""}" placeholder="≥ %" aria-label="≥ %">
      <button class="x" data-k="rm" aria-label="×">×</button>
    </div>`).join("");
}

// How a range bound reads in a tag, e.g. "8%/yr", "10 yrs", "$500M", "2010".
function rangeValue(kind, v) {
  const n = fmtNum(v);
  if (kind === "ret") return pctSign(n) + t("perYr");
  if (kind === "pct") return pctSign(n);
  if (kind === "years") return t("nYears", n);
  if (kind === "musd") return t("nMusd", n);
  return String(v);
}

// The removable chips describing every active filter. Each knows how to clear itself.
function activeFilters() {
  const out = [];
  const pct = (v) => pctSign(fmtNum(v));
  const or = ` ${t("or")} `;
  if (S.q) out.push({ col: "etf", label: t("chipSearch", S.q), clear: () => { S.q = ""; } });
  if (S.types.length) out.push({ col: "type", label: `${t("chipAsset")}: ${S.types.map(typeName).join(or)}`, clear: () => { S.types = []; } });
  if (S.geos.length) out.push({ col: "geo", label: `${t("chipGeo")}: ${S.geos.map((g) => L().geos[g]).join(or)}`, clear: () => { S.geos = []; } });
  if (S.sectors.length) out.push({ col: "sector", label: `${t("chipSector")}: ${S.sectors.map(sectorName).join(or)} ≥ ${pct(S.sectorMin ?? 0)}`, clear: () => { S.sectors = []; } });
  for (const [col, [lo, hi, , kind]] of Object.entries(RANGES)) {
    const name = sortLabel(col);
    if (S[lo] != null) out.push({ col, label: `${name} ≥ ${rangeValue(kind, S[lo])}`, clear: () => { S[lo] = null; } });
    if (S[hi] != null) out.push({ col, label: `${name} ≤ ${rangeValue(kind, S[hi])}`, clear: () => { S[hi] = null; } });
  }
  S.exps.forEach((e) => out.push({
    label: `${labelName(e.dim, e.label)} ≥ ${pct(e.min ?? 0)}`, clear: () => { S.exps = S.exps.filter((x) => x !== e); },
  }));
  return out;
}

let ACTIVE = [];
function renderActiveBar() {
  ACTIVE = activeFilters();
  const n = ACTIVE.length;
  $("filterCount").hidden = !n;
  $("filterCount").textContent = n;
  const head = `<span class="barlabel">${esc(t("filtersLabel"))}</span>`;
  if (!n) {
    $("activeBar").innerHTML = `${head}<span class="muted-note">${esc(t("noFilters"))}</span>`;
    return;
  }
  $("activeBar").innerHTML = head + ACTIVE.map((a, i) =>
    (i ? `<span class="muted-note">${esc(t("and"))}</span>` : "") +
    `<span class="achip">${esc(a.label)}<button data-clear="${i}" aria-label="${esc(t("removeFilter", a.label))}">×</button></span>`).join("") +
    `<button class="linkbtn" id="clearAll">${esc(t("clearAll"))}</button>` +
    (S.basis !== "nav" ? `<span class="muted-note">${esc(t("usesPrice"))}</span>` : "");
}

function renderSortBar() {
  const used = new Set(S.sort.map((r) => r.key));
  const options = Object.keys(SORTS).filter((k) => !used.has(k))
    .map((k) => `<option value="${k}">${esc(sortLabel(k))}</option>`).join("");
  $("sortBar").innerHTML = `<span class="barlabel">${esc(t("sortLabel"))}</span>` + S.sort.map((r, i) => `
    <span class="achip sort"><span class="rank">${i + 1}.</span>${esc(sortLabel(r.key))}
      <button class="dir" data-flip="${i}" aria-label="${esc(t("flip"))}: ${esc(sortLabel(r.key))} (${esc(dirWord(r.key, r.dir))})" title="${esc(t("flip"))}">${r.dir === 1 ? "↑" : "↓"} ${esc(dirWord(r.key, r.dir))}</button>
      ${S.sort.length > 1 ? `<button data-unsort="${i}" aria-label="${esc(t("removeSort", sortLabel(r.key)))}">×</button>` : ""}
    </span>`).join("") +
    `<select id="addSort" aria-label="${esc(t("addSort"))}"><option value="">${esc(t("addSort"))}</option>${options}</select>` +
    `<span class="muted-note">${esc(S.sort.length > 1 ? t("tieNote") : t("tipShift"))}</span>`;
}

function renderColMenu() {
  $("colList").setAttribute("aria-label", t("columnsBtn"));
  $("colList").innerHTML = COLUMNS.map((c) => `
    <label class="${c.locked ? "locked" : ""}"><input type="checkbox" data-col="${c.id}" ${c.locked || !hiddenCols.has(c.id) ? "checked" : ""} ${c.locked ? "disabled" : ""}>
      ${esc(colLabel(c))}${c.unit ? ` <span class="muted small">(${esc(colUnit(c))})</span>` : ""}</label>`).join("") +
    `<div class="menu-foot"><button class="linkbtn" id="colReset">${esc(t("resetCols"))}</button></div>`;
}

// ================================================================== render: results

function update(resetPaging = false) {
  if (resetPaging) cardsShown = CARD_PAGE;
  saveUrl();
  const rows = FUNDS.filter(passes).sort(compareFunds);
  $("countNum").textContent = rows.length;
  $("countOf").textContent = rows.length === FUNDS.length ? t("etfs") : t("ofEtfs", FUNDS.length);
  renderActiveBar();
  renderSortBar();
  renderSpot(rows);

  const empty = !rows.length;
  $("emptyState").hidden = !empty;
  if (empty) {
    $("stateText").textContent = t("noMatch");
    $("emptyClear").hidden = false;
  }
  $("tableView").hidden = empty || S.view !== "table";
  $("cards").hidden = empty || S.view !== "cards";
  if (S.view === "table") renderTable(rows); else renderCards(rows.slice(0, cardsShown));
  $("showMore").hidden = S.view !== "cards" || rows.length <= cardsShown;
  $("showMore").textContent = t("showMore", rows.length - cardsShown);
  renderCompareBar();
}

const FUNNEL = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.6 5.6V13l-2.8-1.4V8.6z" fill="currentColor"/></svg>';
let filteredCols = new Set();

function renderTable(rows) {
  const cols = visibleCols();
  filteredCols = new Set(ACTIVE.map((a) => a.col).filter(Boolean));
  const rank = Object.fromEntries(S.sort.map((r, i) => [r.key, i]));
  $("thead").innerHTML = cols.map((c) => {
    const i = rank[c.sortKey], sorted = i != null;
    const ariaSort = i === 0 ? ` aria-sort="${S.sort[0].dir === 1 ? "ascending" : "descending"}"` : "";
    const unit = c.unit ? ` <span class="unit">${esc(colUnit(c))}</span>` : "";
    const title = c.ret ? (c.ret === "1y" ? t("thRet1") : t("thRetAnn", basisLabel())) : "";
    const mark = sorted ? `<span class="sortmark">${S.sort[i].dir === 1 ? "↑" : "↓"}${S.sort.length > 1 ? i + 1 : ""}</span>` : "";
    const inner = c.sortKey
      ? `<button class="thbtn" data-sort="${c.sortKey}" title="${esc(title ? title + ". " : "")}${esc(t("thSortHint"))}">${esc(colLabel(c))}${unit}${mark}</button>`
      : `${esc(colLabel(c))}${unit}`;
    const on = filteredCols.has(c.id);
    const funnel = `<button class="thf ${on ? "on" : ""}" data-filter="${c.id}" aria-haspopup="dialog" aria-expanded="${popCol === c.id}"
      aria-label="${esc(t(on ? "filterColOn" : "filterCol", colLabel(c)))}" title="${esc(t(on ? "filterColOn" : "filterCol", colLabel(c)))}">${FUNNEL}</button>`;
    return `<th class="${c.num ? "num" : ""} ${c.sticky ? "sticky" : ""} ${sorted ? "sorted" : ""} ${on ? "filtered" : ""}"${ariaSort} scope="col"><span class="thwrap">${inner}${funnel}</span></th>`;
  }).join("");

  $("tbody").innerHTML = rows.map((f, i) => `<tr data-t="${esc(f.ticker)}" class="${S.cmp.includes(f.ticker) ? "picked" : ""}">` + cols.map((c) =>
    `<td class="${c.num ? "num" : ""} ${c.sticky ? "sticky etf" : ""} ${c.expo ? "expo" : ""} ${isMissing(c, f) ? "miss" : ""}">${cellHtml(c, f, i)}</td>`).join("") + "</tr>").join("");
}

function headline(f) {
  const pref = { r1: "1y", r3: "3y", r5: "5y", r10: "10y", rsi: "si" }[S.sort[0].key];
  for (const p of [pref, "10y", "5y", "si", "1y"].filter(Boolean)) {
    const v = ret(f, p);
    if (isNum(v)) return { v, label: p === "1y" ? t("thRet1") : t("perYear", L().period[p]) };
  }
  return { v: null, label: t("tooNew") };
}

function renderCards(rows) {
  $("cards").innerHTML = rows.map((f) => {
    const h = headline(f), a = age(f), on = S.cmp.includes(f.ticker);
    return `<article class="card ${on ? "selected" : ""}" data-t="${esc(f.ticker)}" tabindex="0">
      <div class="card-top">
        <div><div class="tk">${esc(f.ticker)}${isNum(a) && a < 5 ? ` <span class="badge">${esc(t("newBadge"))}</span>` : ""}</div><div class="name">${esc(f.name)}</div></div>
        <button class="addcmp" data-cmp="${esc(f.ticker)}" aria-pressed="${on}" aria-label="${esc(t("compareT", f.ticker))}">${on ? "✓" : "+"}</button>
      </div>
      ${f.description ? `<p class="desc">${esc(f.description)}</p>` : ""}
      <div class="big"><div class="label">${esc(h.label)}</div><div class="v">${fmtBig(h.v)}</div></div>
      <div class="facts">
        <div><div class="label">${esc(t("cost"))}</div><div class="v">${fmtPct(f.expense_ratio)}</div></div>
        <div><div class="label">${esc(t("ageL"))}</div><div class="v">${fmtAge(a)}</div></div>
        <div><div class="label">${esc(t("sizeL"))}</div><div class="v">${fmtAum(f.net_assets)}</div></div>
      </div>
    </article>`;
  }).join("");
}

// ================================================================== spotlight band

let spotTicker = null;
function renderSpot(rows) {
  const f = rows[0];
  spotTicker = f?.ticker || null;
  const r = S.sort[0];
  if (!f) {
    $("spotKicker").textContent = t("spotNone");
    $("spotTitle").textContent = t("spotNoneT");
    $("spotGlass").innerHTML = "";
    return;
  }
  $("spotKicker").textContent = t("spotKicker", sortLabel(r.key), dirWord(r.key, r.dir));
  $("spotTitle").textContent = f.name.replace(/^iShares /, "");
  $("spotTitle").setAttribute("aria-label", t("openDetails", f.ticker, f.name));
  const si = ret(f, "si");
  $("spotGlass").innerHTML = `<div class="k">${esc(t("spotGlassK", f.ticker))}</div>
    <div class="v">${isNum(si) ? signed(si, 1) : "—"}</div>
    <div class="s">${esc(t("spotGlassS", (f.inception_date || "?").slice(0, 4), fmtPct(f.expense_ratio)))}</div>`;
}
$("spotTitle").addEventListener("click", () => spotTicker && openDrawer(spotTicker));
$("dotsBtn").addEventListener("click", () => {
  setPanel(true);
  $("toolbar").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth" });
});

// ================================================================== market clock

// Regular trading sessions in each exchange's local time (minutes after midnight). Holidays not included.
const MARKETS = [
  { id: "ny", ex: "NYSE", tz: "America/New_York", sessions: [[570, 960]] },
  { id: "ldn", ex: "LSE", tz: "Europe/London", sessions: [[480, 990]] },
  { id: "fra", ex: "Xetra", tz: "Europe/Berlin", sessions: [[540, 1050]] },
  { id: "ams", ex: "Euronext", tz: "Europe/Amsterdam", sessions: [[540, 1050]] },
  { id: "tyo", ex: "TSE", tz: "Asia/Tokyo", sessions: [[540, 690], [750, 930]] },
  { id: "hk", ex: "HKEX", tz: "Asia/Hong_Kong", sessions: [[570, 720], [780, 960]] },
];
const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = {};
function localParts(tz, now) {
  fmtCache[tz] ??= new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(fmtCache[tz].formatToParts(now).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  return { day: DAYS[p.weekday], h, m: Number(p.minute), s: Number(p.second), mins: h * 60 + Number(p.minute) };
}
const two = (n) => String(n).padStart(2, "0");
const hm = (mins) => `${two(Math.floor(mins / 60))}:${two(mins % 60)}`;
function dur(mins) { return t("dur", Math.floor(mins / 1440), Math.floor((mins % 1440) / 60), mins % 60); }
function marketState(mk, now) {
  const tp = localParts(mk.tz, now);
  const weekday = tp.day >= 1 && tp.day <= 5;
  const cur = weekday && mk.sessions.find(([o, c]) => tp.mins >= o && tp.mins < c);
  if (cur) return { t: tp, open: true, mins: cur[1] - tp.mins };
  for (let k = 0; k < 8; k++) {
    const day = (tp.day + k) % 7;
    if (day === 0 || day === 6) continue;
    const next = mk.sessions.find(([o]) => k > 0 || o > tp.mins);
    if (next) return { t: tp, open: false, mins: k * 1440 + next[0] - tp.mins, at: next[0], day: k ? day : null };
  }
  return { t: tp, open: false, mins: 0 };
}

function tickClock() {
  const now = new Date();
  const ny = marketState(MARKETS[0], now);
  $("clkH").textContent = two(ny.t.h);
  $("clkM").textContent = two(ny.t.m);
  $("clkS").textContent = two(ny.t.s);
  $("clkSUp").textContent = two((ny.t.s + 59) % 60);
  $("clkSDown").textContent = two((ny.t.s + 1) % 60);
  const when = ny.open ? t("closesIn", dur(ny.mins)) : t("opensIn", dur(ny.mins)) + (ny.day != null ? ` (${L().days[ny.day]} ${hm(ny.at)})` : "");
  $("nyStatus").innerHTML = `<span class="sdot ${ny.open ? "open" : ""}"></span>${t("nyStatus", ny.open)} · ${esc(when)}`;
  $("nyStatus").title = t("hoursNote");

  const me = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const zone = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").split("/").pop().replace(/_/g, " ");
  $("cities").innerHTML = `<div class="city me"><div class="n">${esc(t("yourTime"))}${zone ? ` <span class="ex">${esc(zone)}</span>` : ""}</div><div class="v">${esc(me)}</div></div>` +
    MARKETS.slice(1).map((mk) => {
      const st = marketState(mk, now);
      const hours = mk.sessions.map(([o, c]) => hm(o) + "–" + hm(c)).join(", ");
      return `<div class="city" title="${esc(t("cityTitle", mk.ex, hours))}">
        <div class="n"><span class="sdot ${st.open ? "open" : ""}"></span>${esc(L().cities[mk.id])} <span class="ex">${esc(mk.ex)}</span></div>
        <div class="v">${two(st.t.h)}:${two(st.t.m)}</div>
        <div class="s">${esc(st.open ? t("openLeft", dur(st.mins)) : t("opensIn", dur(st.mins)))}</div></div>`;
    }).join("");
}

// ================================================================== events: controls

function changed() { renderFilterControls(); update(true); }

$("q").addEventListener("input", () => { S.q = $("q").value.trim(); update(true); });

$("filterPanel").addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.closest(".exp")) {
    const e = S.exps[+el.closest(".exp").dataset.i], k = el.dataset.k;
    if (k === "dim") { e.dim = el.value; e.label = (DIMS[e.dim] || [])[0] || ""; renderExps(); }
    else if (k === "label") e.label = el.value;
    else if (k === "min") e.min = el.value === "" ? null : Number(el.value);
  } else if (NUM_FILTERS.includes(el.id)) {
    S[el.id] = el.value.trim() === "" || !isNum(Number(el.value)) ? null : Number(el.value);
  } else if (el.id === "sectorMin") {
    S.sectorMin = el.value === "" ? null : Number(el.value);
  } else if (el.id === "moreSectors") {
    if (el.value && !S.sectors.includes(el.value)) S.sectors.push(el.value);
    renderFilterControls();
  } else return;
  update(true);
});

$("filterPanel").addEventListener("click", (ev) => {
  const b = ev.target.closest("button"); if (!b) return;
  const d = b.dataset;
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  if ("type" in d) S.types = toggle(S.types, d.type);
  else if ("geo" in d) S.geos = toggle(S.geos, d.geo);
  else if ("sector" in d) S.sectors = toggle(S.sectors, d.sector);
  else if ("q" in d) { const k = b.parentElement.dataset.for; S[k] = Number(d.q); $(k).value = d.q; }
  else if (b.closest("#basis")) S.basis = d.v;
  else if (d.k === "rm") { S.exps.splice(+b.closest(".exp").dataset.i, 1); renderExps(); }
  else if (b.id === "addExp") {
    S.exps.push({ dim: "region", label: (DIMS.region || []).includes("Europe") ? "Europe" : (DIMS.region || [""])[0], min: 50 });
    renderExps();
  } else return;
  changed();
});

$("toggleFilters").addEventListener("click", () => setPanel($("filterPanel").hidden));
function setPanel(open) {
  $("filterPanel").hidden = !open;
  $("toggleFilters").setAttribute("aria-expanded", String(open));
  lsSet("fs.panel", open ? "1" : "0");
}

$("viewSeg").addEventListener("click", (ev) => {
  const v = ev.target.closest("button")?.dataset.v; if (!v) return;
  S.view = v; renderFilterControls(); update(true);
});

$("activeBar").addEventListener("click", (ev) => {
  const b = ev.target.closest("button"); if (!b) return;
  if (b.id === "clearAll") clearAll();
  else if (b.dataset.clear != null) {
    ACTIVE[+b.dataset.clear].clear();
    syncInputs(); update(true);
    if (popCol) openPop(popCol);
    $("activeBar").querySelector("button")?.focus();
  }
});
function clearAll() {
  const keep = { basis: S.basis, sort: S.sort, cmp: S.cmp, view: S.view };
  Object.assign(S, blankFilters(), keep);
  syncInputs(); update(true);
}
$("emptyClear").addEventListener("click", clearAll);

$("sortBar").addEventListener("click", (ev) => {
  const b = ev.target.closest("button"); if (!b) return;
  if (b.dataset.flip != null) { const r = S.sort[+b.dataset.flip]; r.dir = -r.dir; }
  else if (b.dataset.unsort != null) S.sort.splice(+b.dataset.unsort, 1);
  else return;
  update();
  $("sortBar").querySelector(`[data-flip="${b.dataset.flip}"]`)?.focus();
});
$("sortBar").addEventListener("change", (ev) => {
  if (ev.target.id !== "addSort" || !ev.target.value) return;
  const key = ev.target.value;
  S.sort.push({ key, dir: SORTS[key].dir });
  update();
  $("addSort").focus();
});

$("thead").addEventListener("click", (ev) => {
  const fb = ev.target.closest("[data-filter]");
  if (fb) { popCol === fb.dataset.filter ? closePop(true) : openPop(fb.dataset.filter); return; }
  const key = ev.target.closest("[data-sort]")?.dataset.sort; if (!key) return;
  const i = S.sort.findIndex((r) => r.key === key);
  if (ev.shiftKey) {
    if (i === -1) S.sort.push({ key, dir: SORTS[key].dir }); else S.sort[i].dir *= -1;
  } else if (i === 0) {
    S.sort[0].dir *= -1;
  } else {
    S.sort = [{ key, dir: SORTS[key].dir }];
  }
  update();
  $("thead").querySelector(`[data-sort="${key}"]`)?.focus();
});

$("colList").addEventListener("change", (ev) => {
  const id = ev.target.dataset.col; if (!id) return;
  if (ev.target.checked) hiddenCols.delete(id); else hiddenCols.add(id);
  lsSet("fs.hiddenCols", JSON.stringify([...hiddenCols]));
  update();
});
$("colList").addEventListener("click", (ev) => {
  if (ev.target.id !== "colReset") return;
  hiddenCols = defaultHidden();
  lsSet("fs.hiddenCols", JSON.stringify([...hiddenCols]));
  renderColMenu(); update();
});
const defaultHidden = () => new Set(COLUMNS.filter((c) => !c.locked && !c.def).map((c) => c.id));
document.addEventListener("click", (ev) => { if (!ev.target.closest("#colMenu")) $("colMenu").open = false; });

$("showMore").addEventListener("click", () => { cardsShown += CARD_PAGE * 2; update(); });

// ================================================================== column filter pop-up

let popCol = null;

function popAnchor() { return $("thead").querySelector(`[data-filter="${popCol}"]`); }

function placePop() {
  const a = popAnchor(), pop = $("colPop");
  if (!a) { closePop(); return; }
  const r = a.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.top = `${Math.round(r.bottom + 8)}px`;
  pop.style.left = `${Math.round(Math.min(Math.max(8, r.right - w), innerWidth - w - 8))}px`;
}

function checkList(attr, items, selected) {
  return `<div class="pchecks">${items.map(([v, label]) => `
    <label><input type="checkbox" data-${attr}="${esc(v)}" ${selected.includes(v) ? "checked" : ""}> ${esc(label)}</label>`).join("")}</div>`;
}

function popBody(id) {
  if (id === "etf") {
    return `<label class="pfield">${esc(t("contains"))}<input type="search" data-pk="q" value="${esc(S.q)}" placeholder="${esc(t("searchShort"))}"></label>`;
  }
  if (id === "type") {
    const present = new Set(FUNDS.map((f) => f.asset_class));
    return `<p class="phint">${esc(t("anyOfHint"))}</p>` + checkList("ptype", TYPE_KEYS.filter((k) => present.has(k)).map((k) => [k, typeName(k)]), S.types);
  }
  if (id === "geo") {
    return `<p class="phint">${esc(t("anyOfHint"))}</p>` + checkList("pgeo", Object.keys(GEO_TESTS).map((k) => [k, L().geos[k]]), S.geos);
  }
  if (id === "sector") {
    const items = [...new Set([...SECTOR_COMMON, ...S.sectors])].map((k) => [k, sectorName(k)]);
    return `<p class="phint">${esc(t("anyOfHint"))}</p>` + checkList("psector", items, S.sectors) +
      `<label class="pfield inline">${esc(t("atLeast"))} <input type="number" data-pk="sectorMin" min="0" max="100" step="5" value="${S.sectorMin ?? ""}"> %</label>`;
  }
  const [lo, hi, , kind] = RANGES[id];
  const unit = { ret: t("unitRet"), pct: "%", years: t("unitYears"), musd: t("unitMusd"), year: "" }[kind];
  const step = { ret: 0.5, pct: 0.05, years: 1, musd: 50, year: 1 }[kind];
  return `<div class="prange">
      <label class="pfield">${esc(kind === "year" ? t("fromYear") : t("min"))}<input type="number" step="${step}" data-pk="${lo}" value="${S[lo] ?? ""}"></label>
      <span class="pdash">–</span>
      <label class="pfield">${esc(kind === "year" ? t("toYear") : t("max"))}<input type="number" step="${step}" data-pk="${hi}" value="${S[hi] ?? ""}"></label>
      ${unit ? `<span class="punit">${esc(unit)}</span>` : ""}
    </div>` + (kind === "ret" ? `<p class="phint">${esc(t("youngHint"))}</p>` : "");
}

function openPop(id) {
  const col = COLUMNS.find((c) => c.id === id); if (!col) return;
  popCol = id;
  const pop = $("colPop");
  pop.innerHTML = `<div class="phead"><span class="label">${esc(t("filterCol", colLabel(col)))}</span>
      <button class="x" data-pact="close" aria-label="${esc(t("close"))}">×</button></div>
    ${popBody(id)}
    <div class="pfoot"><button class="linkbtn" data-pact="clear">${esc(t("clearFilter"))}</button>
      <button class="btn small primary" data-pact="close">${esc(t("done"))}</button></div>`;
  pop.setAttribute("aria-label", t("filterCol", colLabel(col)));
  pop.hidden = false;
  placePop();
  $("thead").querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-expanded", String(b.dataset.filter === id)));
  pop.querySelector("input")?.focus();
}

function closePop(refocus = false) {
  if (!popCol) return;
  const id = popCol;
  popCol = null;
  $("colPop").hidden = true;
  $("thead").querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-expanded", "false"));
  if (refocus) $("thead").querySelector(`[data-filter="${id}"]`)?.focus();
}

function clearColFilter(id) {
  if (id === "etf") S.q = "";
  else if (id === "type") S.types = [];
  else if (id === "geo") S.geos = [];
  else if (id === "sector") S.sectors = [];
  else if (RANGES[id]) { S[RANGES[id][0]] = null; S[RANGES[id][1]] = null; }
}

$("colPop").addEventListener("input", (ev) => {
  const el = ev.target, d = el.dataset;
  const toggle = (arr, v, on) => (on ? [...new Set([...arr, v])] : arr.filter((x) => x !== v));
  if (d.pk === "q") S.q = el.value.trim();
  else if (d.pk) S[d.pk] = el.value.trim() === "" || !isNum(Number(el.value)) ? null : Number(el.value);
  else if ("ptype" in d) S.types = toggle(S.types, d.ptype, el.checked);
  else if ("pgeo" in d) S.geos = toggle(S.geos, d.pgeo, el.checked);
  else if ("psector" in d) S.sectors = toggle(S.sectors, d.psector, el.checked);
  else return;
  syncPanel();
  update(true);
  placePop();
});
$("colPop").addEventListener("click", (ev) => {
  const act = ev.target.closest("[data-pact]")?.dataset.pact; if (!act) return;
  if (act === "clear") { const id = popCol; clearColFilter(id); syncPanel(); update(true); openPop(id); }
  else closePop(true);
});
$("colPop").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.tagName === "INPUT" && ev.target.type !== "checkbox") closePop(true);
});
document.addEventListener("mousedown", (ev) => {
  if (popCol && !ev.target.closest("#colPop") && !ev.target.closest("[data-filter]")) closePop();
});
addEventListener("resize", () => popCol && placePop());
addEventListener("scroll", () => popCol && placePop(), { passive: true });
$("tableView").addEventListener("scroll", () => popCol && placePop(), { passive: true });

// Keep the Filters panel showing the same values as the table filters, without stealing focus.
function syncPanel() {
  $("q").value = S.q;
  for (const k of NUM_FILTERS) if ($(k) && document.activeElement !== $(k)) $(k).value = S[k] ?? "";
  $("sectorMin").value = S.sectorMin ?? "";
  renderFilterControls();
}

// ================================================================== events: results

function toggleCmp(tk) {
  if (S.cmp.includes(tk)) S.cmp = S.cmp.filter((x) => x !== tk);
  else if (S.cmp.length < MAX_COMPARE) S.cmp.push(tk);
  update();
}

for (const id of ["tbody", "cards"]) {
  $(id).addEventListener("click", (ev) => {
    const cmp = ev.target.closest("[data-cmp]");
    if (cmp) { ev.preventDefault(); toggleCmp(cmp.dataset.cmp); return; }
    const row = ev.target.closest("[data-t]"); if (!row) return;
    openDrawer(row.dataset.t, ev.target.closest("[data-expo]")?.dataset.expo);
  });
}
$("cards").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.classList.contains("card")) openDrawer(ev.target.dataset.t);
});

// ================================================================== detail drawer

function bars(list, dim, limit) {
  const shownList = limit ? list.slice(0, limit) : list;
  const max = Math.max(...list.map(([, w]) => Math.abs(w)), 1);
  return `<div class="bars">${shownList.map(([l, w]) => `
    <span>${esc(labelName(dim, l))}</span>
    <span class="track"><span class="fill" style="width:${(Math.max(w, 0) / max) * 100}%"></span></span>
    <span class="v">${pctSign(fx(w, 1))}</span>`).join("")}</div>`;
}

function exposureSections(f) {
  const order = ["region", "country", "sector", "maturity", "rating"];
  const dims = Object.keys(f.exposures).sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)));
  if (!dims.length) return `<div class="section-h"><h3>${esc(t("whatHolds"))}</h3></div><p class="muted small">${esc(t("noBreakdown"))}</p>`;
  return dims.map((d) => {
    const list = f.exposures[d];
    const notes = [];
    if (d === "region") notes.push(t("fromCountries"));
    if ((d === "region" || d === "country") && f.country_assumed) notes.push(t("assumed100"));
    if (f.exposures_as_of[d]) notes.push(t("asOf", f.exposures_as_of[d]));
    const limit = list.length > 10 ? 10 : 0;
    return `<section id="dim-${esc(d)}"><div class="section-h"><h3>${esc(dimName(d))}</h3><span class="asof">${esc(notes.join(" · "))}</span></div>
      <div data-dim="${esc(d)}">${bars(list, d, limit)}</div>
      ${limit ? `<button class="btn small more-btn" data-more="${esc(d)}">${esc(t("showAll", list.length))}</button>` : ""}</section>`;
  }).join("");
}

// ------------------------------------------------------------------ holdings (loaded per fund on demand)

const HOLDINGS = {};          // ticker -> parsed file, "missing", or a pending promise
const HOLDINGS_SHOWN = 10;

async function loadHoldings(ticker) {
  if (!HOLDINGS[ticker]) {
    HOLDINGS[ticker] = fetch(`/static/data/holdings/${encodeURIComponent(ticker)}.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : "missing")).catch(() => "missing");
  }
  const data = await HOLDINGS[ticker];
  HOLDINGS[ticker] = data;
  if (drawerTicker === ticker && $("holdingsSec")) $("holdingsSec").innerHTML = holdingsHtml(ticker);
}

const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Plc|Ag|Sa|Nv|Se|Inc|Corp|Ltd|Co)\b/g, (w) => w.toUpperCase());

// Description in the UI language: Czech Wikipedia when available, otherwise English (marked as such).
function aboutText(a) {
  if (!a) return null;
  if (LANG === "cs" && a.summary_cs) return { text: a.summary_cs, lang: "cs", wiki: a.wiki_cs, host: "cs" };
  if (a.summary) return { text: a.summary, lang: "en", wiki: a.wiki, host: "en", fallback: LANG !== "en" };
  return null;
}
function aboutTags(a) {
  if (!a) return [];
  const pick = (k) => (LANG === "cs" && a[k + "_cs"]?.length ? a[k + "_cs"] : a[k] || []);
  return [...new Set([...pick("products"), ...pick("industry")])].slice(0, 4);
}

function holdingRow(h, i) {
  const a = h.about, ab = aboutText(a), tags = aboutTags(a);
  const name = a?.label || titleCase(h.name);
  const meta = [h.ticker && h.ticker !== "-" ? h.ticker : null, h.country,
    h.maturity ? t("matures", h.maturity) : null, h.coupon ? t("coupon", pctSign(dec(h.coupon))) : null].filter(Boolean);
  const expandable = !!(ab || tags.length);
  const id = `hold-${i}`;
  const top = `<span class="hold-rank">${i + 1}</span>
      <span class="hold-name" title="${esc(h.name)}">${esc(name)}</span>
      <span class="hold-w">${pctSign(fx(h.weight, 2))}</span>
      <span class="hold-chev" aria-hidden="true">${expandable ? "›" : ""}</span>`;
  return `<li class="hold" style="--w:${(h.weight / HOLD_MAX * 100).toFixed(1)}%">
    ${expandable
      ? `<button class="hold-top" aria-expanded="false" aria-controls="${id}" title="${esc(t("whatTheyDo"))}">${top}</button>`
      : `<div class="hold-top">${top}</div>`}
    <div class="hold-meta">${esc(meta.join(" · "))}</div>
    ${expandable ? `<div class="hold-more" id="${id}" hidden>
      ${ab ? `<p class="hold-about" lang="${ab.lang}">${esc(ab.text)}${ab.fallback ? ` <span class="muted">(${esc(t("inEnglish"))})</span>` : ""}</p>` : ""}
      <div class="hold-tags">${tags.map((x) => `<span>${esc(x)}</span>`).join("")}${ab?.wiki
        ? `<a href="https://${ab.host}.wikipedia.org/wiki/${encodeURIComponent(ab.wiki.replace(/ /g, "_"))}" target="_blank" rel="noopener">Wikipedia ↗</a>` : ""}</div>
    </div>` : ""}
  </li>`;
}

let HOLD_MAX = 1;
function holdingsHtml(ticker, all = false) {
  const head = (extra = "") => `<div class="section-h"><h3>${esc(t("topHoldings"))}</h3><span class="asof">${extra}</span></div>`;
  const data = HOLDINGS[ticker];
  if (!data || data instanceof Promise) return head() + `<p class="muted small">${esc(t("loadingHoldings"))}</p>`;
  if (data === "missing" || !data.holdings.length) return head() + `<p class="muted small">${esc(t("noHoldings"))}</p>`;
  const list = all ? data.holdings : data.holdings.slice(0, HOLDINGS_SHOWN);
  const topSum = data.holdings.slice(0, HOLDINGS_SHOWN).reduce((s, h) => s + h.weight, 0);
  HOLD_MAX = Math.max(...data.holdings.map((h) => h.weight), 1);
  const anyAbout = list.some((h) => aboutText(h.about) || aboutTags(h.about).length);
  return head(esc([t("positions", data.count), data.as_of ? t("asOf", data.as_of) : ""].filter(Boolean).join(" · "))) +
    `<div class="hold-sumrow"><p class="hold-sum">${esc(t("topShare", Math.min(HOLDINGS_SHOWN, data.holdings.length), pctSign(fx(topSum, 1))))}</p>
      ${anyAbout ? `<button class="linkbtn" data-expandall="1">${esc(t("expandAll"))}</button>` : ""}</div>
    <ol class="holds">${list.map(holdingRow).join("")}</ol>
    ${!all && data.holdings.length > HOLDINGS_SHOWN ? `<button class="btn small more-btn" data-allholdings="${esc(ticker)}">${esc(t("showTopN", data.holdings.length))}</button>` : ""}
    ${data.holdings.some((h) => h.about) ? `<p class="note">${esc(t("aboutNote"))}</p>` : ""}`;
}

$("drawer").addEventListener("click", (ev) => {
  const tk = ev.target.closest("[data-allholdings]")?.dataset.allholdings;
  if (tk) { $("holdingsSec").innerHTML = holdingsHtml(tk, true); return; }
  const row = ev.target.closest("button.hold-top");
  if (row) { setHoldOpen(row, row.getAttribute("aria-expanded") !== "true"); return; }
  const all = ev.target.closest("[data-expandall]");
  if (all) {
    const open = all.dataset.expandall === "1";
    $("holdingsSec").querySelectorAll("button.hold-top").forEach((b) => setHoldOpen(b, open));
    all.dataset.expandall = open ? "0" : "1";
    all.textContent = t(open ? "collapseAll" : "expandAll");
  }
});
function setHoldOpen(btn, open) {
  btn.setAttribute("aria-expanded", String(open));
  $(btn.getAttribute("aria-controls")).hidden = !open;
  btn.closest(".hold").classList.toggle("open", open);
}

// Cumulative growth implied by an annualized return over n years: exact for fixed periods.
function cumulative(annual, years) {
  if (!isNum(annual) || !isNum(years) || years < 1) return null;
  return (Math.pow(1 + annual / 100, years) - 1) * 100;
}

let lastFocus = null;
function openDrawer(ticker, focusDim) {
  const f = FUNDS.find((x) => x.ticker === ticker); if (!f) return;
  if ($("drawer").hidden) lastFocus = document.activeElement;
  drawerTicker = ticker;
  const a = age(f), si = ret(f, "si"), on = S.cmp.includes(f.ticker);
  const asOf = f[S.basis + "_returns_as_of"];
  const siYears = asOf && f.inception_date ? (new Date(asOf) - new Date(f.inception_date)) / (365.25 * 864e5) : null;
  const years = { "1y": 1, "3y": 3, "5y": 5, "10y": 10, si: siYears };
  const fact = (label, v, s = "") => `<div><div class="label">${esc(label)}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
  const retRows = ["1y", "3y", "5y", "10y", "si"].map((p) => {
    const v = ret(f, p);
    return `<tr><th>${esc(L().period[p])}</th><td class="num">${fmtRet(v)}</td><td class="num">${p === "1y" ? fmtRet(v) : fmtRet(cumulative(v, years[p]), 1)}</td></tr>`;
  }).join("");
  const region = f.primary_region ? regionName(f.primary_region) : "—";
  const regionSub = f.market_type === "Emerging" ? t("emerging") : f.primary_country && f.primary_country !== f.primary_region ? f.primary_country : "";

  $("drawer").setAttribute("aria-label", `${f.ticker} · ${f.name}`);
  $("drawer").innerHTML = `
    <div class="dhead">
      <div><h2>${esc(f.ticker)}</h2><div class="name muted">${esc(f.name)}</div></div>
      <button class="x" id="closeDrawer" aria-label="${esc(t("closeDetails"))}">×</button>
    </div>
    ${f.description ? `<div class="bubble"><img src="/static/img/graphite-bull-sm.webp" width="320" height="244" alt="" class="mascot"><p lang="en">${esc(f.description)}${t("descNote") ? `<span class="descnote" lang="${LANG}">${esc(t("descNote"))}</span>` : ""}</p></div>` : ""}

    <div class="dhero">
      <div class="label">${isNum(si) ? esc(t("annSince", f.inception_date.slice(0, 4))) : esc(t("tooNewAnn"))}</div>
      <div class="v">${fmtBig(si)}</div>
      <div class="periods">
        ${["1y", "3y", "5y", "10y"].map((p) => `<div><div class="label">${esc(L().periodShort[p])}</div><div class="v">${fmtBig(ret(f, p))}</div></div>`).join("")}
      </div>
    </div>

    <div class="facts-grid">
      ${fact(t("expense"), fmtPct(f.expense_ratio), esc(t("perYearS")))}
      ${fact(t("fundSize"), fmtAum(f.net_assets), f.net_assets_as_of ? esc(t("asOf", f.net_assets_as_of)) : "")}
      ${fact(t("ageL"), fmtAge(a), f.inception_date ? esc(t("launchedOn", f.inception_date)) : "")}
      ${fact(t("fAsset"), esc(typeName(f.asset_class)), esc(f.sub_asset_class || ""))}
      ${fact(t("mainRegion"), esc(region), esc(regionSub))}
      ${fact(t("yieldL"), fmtPct(f.ttm_yield), esc(t("trailing")))}
    </div>

    <div class="sources">
      <button class="btn primary" id="drawerCmp" aria-pressed="${on}">${esc(on ? t("inCompare") : t("addCompare"))}</button>
      <a class="btn" href="${esc(f.product_url)}" target="_blank" rel="noopener">${esc(t("isharesPage"))}</a>
      ${f.factsheet_url ? `<a class="btn" href="${esc(f.factsheet_url)}" target="_blank" rel="noopener">${esc(t("factsheetPdf"))}</a>` : ""}
    </div>

    <section id="holdingsSec" aria-live="polite">${holdingsHtml(f.ticker)}</section>

    ${exposureSections(f)}

    <div class="section-h"><h3>${esc(t("returns"))}</h3><span class="asof">${esc(basisLabel())} · ${esc(t("asOf", asOf || "?"))}</span></div>
    <table class="mini"><thead><tr><th>${esc(t("periodL"))}</th><th class="num">${esc(t("annualized"))}</th><th class="num">${esc(t("cumulative"))}</th></tr></thead><tbody>${retRows}</tbody></table>
    <p class="note">${esc(t("cumNote"))}</p>

    <div class="section-h"><h3>${esc(t("sources"))}</h3></div>
    <dl class="kv">
      <dt>${esc(t("productPage"))}</dt><dd><a href="${esc(f.product_url)}" target="_blank" rel="noopener">ishares.com ↗</a></dd>
      <dt>${esc(t("factsheet"))}</dt><dd>${f.factsheet_url ? `<a href="${esc(f.factsheet_url)}" target="_blank" rel="noopener">PDF ↗</a>` : esc(t("notFound"))}</dd>
      <dt>${esc(t("navAsOf"))}</dt><dd>${esc(f.nav_returns_as_of || "—")}</dd>
      <dt>${esc(t("priceAsOf"))}</dt><dd>${esc(f.price_returns_as_of || "—")}</dd>
      <dt>${esc(t("sizeAsOf"))}</dt><dd>${esc(f.net_assets_as_of || "—")}</dd>
      <dt>${esc(t("fetched"))}</dt><dd>${esc((f.page_fetched_at || "").slice(0, 10) || "—")}</dd>
      <dt>ISIN / CUSIP</dt><dd>${esc(f.isin || "—")} / ${esc(f.cusip || "—")}</dd>
      <dt>${esc(t("netGross"))}</dt><dd>${fmtPct(f.expense_ratio)} / ${fmtPct(f.gross_expense_ratio)}</dd>
    </dl>
    <p class="note">${esc(t("snapNote", (META.imported_at || "").slice(0, 10)))}</p>`;

  $("drawer").hidden = false; $("overlay").hidden = false;
  $("drawer").querySelectorAll("[data-more]").forEach((b) => b.addEventListener("click", () => {
    const d = b.dataset.more;
    $("drawer").querySelector(`[data-dim="${CSS.escape(d)}"]`).innerHTML = bars(f.exposures[d], d);
    b.remove();
  }));
  $("drawerCmp").addEventListener("click", () => { toggleCmp(f.ticker); openDrawer(f.ticker); });
  loadHoldings(f.ticker);
  $("closeDrawer").addEventListener("click", closeAll);
  const target = focusDim && $("dim-" + focusDim);
  if (target) target.scrollIntoView({ block: "start", behavior: reducedMotion.matches ? "auto" : "smooth" });
  else if (!focusDim) $("drawer").scrollTop = 0;
  $("closeDrawer").focus({ preventScroll: true });
}

function closeAll() {
  const wasOpen = !$("drawer").hidden || !$("compare").hidden;
  $("drawer").hidden = true; $("compare").hidden = true; $("overlay").hidden = true;
  drawerTicker = null;
  if (wasOpen && lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
$("overlay").addEventListener("click", closeAll);
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (popCol) { closePop(true); return; }
  if ($("colMenu").open) { $("colMenu").open = false; $("colMenu").querySelector("summary").focus(); return; }
  closeAll();
});

// ================================================================== compare

function renderCompareBar() {
  $("compareBar").hidden = S.cmp.length === 0;
  $("compareInfo").textContent = S.cmp.join(" · ") + (S.cmp.length >= MAX_COMPARE ? t("maxNote") : "");
  $("compareOpen").disabled = S.cmp.length < 2;
  $("compareOpen").textContent = S.cmp.length < 2 ? t("pick2") : t("compareN", S.cmp.length);
}
$("compareClear").addEventListener("click", () => { S.cmp = []; update(); });
$("compareOpen").addEventListener("click", openCompare);

function openCompare() {
  if ($("compare").hidden) lastFocus = document.activeElement;
  const fs = S.cmp.map((tk) => FUNDS.find((f) => f.ticker === tk)).filter(Boolean);
  const row = (label, vals, fmt, best) => {
    const nums = vals.filter(isNum);
    const bestV = best && nums.length > 1 ? (best === "max" ? Math.max(...nums) : Math.min(...nums)) : null;
    return `<tr><th>${label}</th>${vals.map((v) => `<td class="num ${isNum(v) && v === bestV ? "best" : ""}">${fmt(v)}</td>`).join("")}</tr>`;
  };
  const sec = (s) => `<tr class="sec"><th colspan="${fs.length + 1}">${s}</th></tr>`;
  const exRows = (dim) => {
    const labels = [...new Set(fs.flatMap((f) => (f.exposures[dim] || []).map(([l]) => l)))];
    const tot = (l) => fs.reduce((s, f) => s + expo(f, dim, l), 0);
    labels.sort((a, b) => tot(b) - tot(a));
    return labels.slice(0, 12).map((l) => row(esc(labelName(dim, l)), fs.map((f) => (f.exposures[dim] ? expo(f, dim, l) : null)), (v) => fmtPct(v, 1))).join("");
  };
  const r = (p) => fs.map((f) => ret(f, p));
  const P = L().period;
  $("compare").setAttribute("aria-label", t("compare"));
  $("compare").innerHTML = `
    <div class="dhead"><h2>${esc(t("compare"))}</h2><button class="x" id="closeCompare" aria-label="${esc(t("closeCompare"))}">×</button></div>
    <div style="overflow-x:auto;margin-top:16px"><table class="mini cmp">
      <thead><tr><th></th>${fs.map((f) => `<th class="num">${esc(f.ticker)}</th>`).join("")}</tr></thead>
      <tbody>
        <tr><th>${esc(t("nameL"))}</th>${fs.map((f) => `<td class="num small wrap">${esc(f.name)}</td>`).join("")}</tr>
        <tr><th>${esc(t("whatItDoes"))}</th>${fs.map((f) => `<td class="desc-cell" lang="en">${esc(f.description || "—")}</td>`).join("")}</tr>
        ${sec(esc(t("basics")))}
        <tr><th>${esc(t("fAsset"))}</th>${fs.map((f) => `<td class="num">${esc(typeName(f.asset_class))}</td>`).join("")}</tr>
        <tr><th>${esc(t("launched"))}</th>${fs.map((f) => `<td class="num">${esc(f.inception_date || "—")}</td>`).join("")}</tr>
        ${row(esc(t("expense")), fs.map((f) => f.expense_ratio), (v) => fmtPct(v), "min")}
        ${row(esc(t("fundSize")), fs.map((f) => f.net_assets), fmtAum, "max")}
        ${sec(esc(t("annRet", basisLabel(), fs[0]?.[S.basis + "_returns_as_of"] || "")))}
        ${row(esc(P["1y"]), r("1y"), (v) => fmtRet(v), "max")}
        ${row(esc(P["3y"]), r("3y"), (v) => fmtRet(v), "max")}
        ${row(esc(P["5y"]), r("5y"), (v) => fmtRet(v), "max")}
        ${row(esc(P["10y"]), r("10y"), (v) => fmtRet(v), "max")}
        ${row(esc(P.si), r("si"), (v) => fmtRet(v), "max")}
        ${sec(esc(dimName("region")))}${exRows("region")}
        ${sec(esc(t("sectorsTop")))}${exRows("sector")}
      </tbody>
    </table></div>
    <p class="note">${esc(t("cmpNote"))}</p>`;
  $("compare").hidden = false; $("overlay").hidden = false;
  $("closeCompare").addEventListener("click", closeAll);
  $("closeCompare").focus();
}

// ================================================================== init

async function init() {
  applyStatic();
  tickClock();
  setInterval(tickClock, 1000);
  $("tableView").hidden = true;
  $("emptyState").hidden = false;
  $("stateText").textContent = t("loading");
  $("emptyState").classList.add("loading");
  let fr, mr;
  try {
    // Static JSON written by the importer (importer/export_static.py): works locally and on a static host.
    [fr, mr] = await Promise.all([fetch("/static/data/funds.json", { cache: "no-cache" }), fetch("/static/data/meta.json", { cache: "no-cache" })]);
  } catch {
    $("stateText").textContent = t("noServer");
    return;
  }
  if (!fr.ok) { $("stateText").textContent = (await fr.json().catch(() => ({}))).detail || t("loadFail"); return; }
  FUNDS = await fr.json();
  $("emptyState").classList.remove("loading");
  META = mr.ok ? await mr.json() : {};

  const sectorUse = {};
  for (const f of FUNDS) for (const [d, list] of Object.entries(f.exposures)) {
    DIMS[d] ??= new Set();
    list.forEach(([l]) => { DIMS[d].add(l); if (d === "sector") sectorUse[l] = (sectorUse[l] || 0) + 1; });
  }
  for (const d of Object.keys(DIMS)) DIMS[d] = [...DIMS[d]].sort();
  SECTOR_COMMON = Object.entries(sectorUse).filter(([l, n]) => n >= 150 && !/Cash|Other/.test(l))
    .sort((a, b) => b[1] - a[1]).map(([l]) => l);

  applyStatic();
  try { hiddenCols = new Set(JSON.parse(lsGet("fs.hiddenCols"))); } catch { hiddenCols = defaultHidden(); }
  if (!lsGet("fs.hiddenCols")) hiddenCols = defaultHidden();
  renderColMenu();

  const load = () => {
    loadUrl(); syncInputs();
    setPanel(lsGet("fs.panel") === "1");     // filters live in the table; the big panel opens only on request
    update(true);
  };
  load();
  window.addEventListener("hashchange", load);
}
init();
