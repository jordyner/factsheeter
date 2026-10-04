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
  top10: ["minTop10", "maxTop10", (f) => f.conc?.top10 ?? null, "pct"],
};
const NUM_FILTERS = Object.values(RANGES).flatMap(([lo, hi]) => [lo, hi]);
const blankFilters = () => ({
  q: "", types: [], geos: [], sectors: [], xtypes: [], xgeos: [], xsectors: [], sectorMin: DEFAULT_SECTOR_MIN, exps: [],
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
const labelName = (dim, l) => (dim === "region" ? regionName(l) : dim === "sector" ? sectorName(l) : dim === "country" ? countryName(l)
  : dim === "maturity" ? maturityName(l) : dim === "rating" ? ratingName(l) : l);
const fundDesc = (f) => (LANG === "cs" && f.description_cs) || f.description || "";
const subAssetName = (s) => (s && L().subAsset?.[s]) || s || "";
// "3 - 5 Years" -> "3–5 let", "20+ Years", "91-120" (days, money-market funds)
function maturityName(l) {
  let m;
  if ((m = /^(\d+)\s*-\s*(\d+)\s*years?$/i.exec(l))) return t("matRange", m[1], m[2]);
  if ((m = /^(\d+)\+\s*years?$/i.exec(l))) return t("matPlus", m[1]);
  if ((m = /^(\d+)\s*-\s*(\d+)$/.exec(l))) return t("matDays", m[1], m[2]);
  if (/^cash/i.test(l)) return t("cashOther");
  return l;
}
// "AA Rated" -> "AA", "Not Rated" -> "Bez ratingu"
function ratingName(l) {
  let m;
  if ((m = /^([A-D]{1,3}[+-]?) rated$/i.exec(l))) return m[1].toUpperCase();
  if (/^not rated$/i.test(l)) return t("notRated");
  if (/^aaa or above$/i.test(l)) return t("aaaAbove");
  if (/^cash/i.test(l)) return t("cashOther");
  return l;
}
// "2026-10-01" or "Oct 01, 2026" -> "1 Oct 2026" / "1. 10. 2026"
function fmtDate(s) {
  if (!s) return "";
  const iso = /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) + "T00:00:00Z" : s + " UTC";
  const d = new Date(iso);
  if (isNaN(d)) return s;
  return LANG === "cs" ? `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// "Denmark" -> "Dánsko": map iShares' English country names to ISO codes once, then ask the browser
// for the name in the UI language. Unknown names stay as they are.
const COUNTRY_CODE = (() => {
  const map = {};
  try {
    const en = new Intl.DisplayNames(["en"], { type: "region" });
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of A) for (const b of A) {
      const code = a + b, name = en.of(code);
      if (name && name !== code) map[name.toLowerCase()] = code;
    }
    Object.assign(map, { "korea (south)": "KR", "south korea": "KR", "russian federation": "RU", "czech republic": "CZ",
      "hong kong": "HK", "taiwan": "TW", "united states": "US", "turkey": "TR", "viet nam": "VN" });
  } catch { /* old browser: names stay English */ }
  return map;
})();
const countryNames = {};
function countryName(name) {
  if (LANG === "en" || !name) return name;
  const code = COUNTRY_CODE[name.toLowerCase()];
  if (!code) return name;
  try { return (countryNames[LANG] ??= new Intl.DisplayNames([LANG], { type: "region" })).of(code) || name; } catch { return name; }
}

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
  renderIntro();
  renderThemeBtn();
  document.querySelectorAll("#langSeg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === LANG)));
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
  return LANG === "cs" ? `${n} ${unit[1]} USD` : `$${n}${unit[0]}`;
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
  { id: "geo", def: true, expo: "region" },
  { id: "sector", def: true, expo: "sector" },
  { id: "largest", sortKey: "largest" },
  { id: "size", num: true, sortKey: "size" },
  { id: "type", sortKey: "type" },
  { id: "yield", unit: "m12", num: true, sortKey: "yield" },
  { id: "fee", num: true, sortKey: "fee", def: true },
  { id: "top10", num: true, sortKey: "top10", def: true },
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
  top10: { get: (f) => f.conc?.top10 ?? null, dir: -1 },
  largest: { get: (f) => f.conc?.top1?.weight ?? null, dir: -1 },
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
        <span class="nm" title="${esc(fundDesc(f) || f.name)}">${esc(f.name.replace(/^iShares /, ""))}${isNum(a) && a < 5 ? `<span class="badge" title="${esc(t("newTitle"))}">${esc(t("newBadge"))}</span>` : ""}</span>
      </div>`;
    }
    case "age": return fmtAge(age(f), false);
    case "inception": return esc(f.inception_date || "—");
    case "fee": return fmtPct(f.expense_ratio);
    case "size": return fmtAum(f.net_assets);
    case "type": return esc(typeName(f.asset_class));
    case "yield": return fmtPct(f.ttm_yield);
    case "top10": return f.conc ? fmtPct(f.conc.top10, 1) : "—";
    case "largest": return f.conc && f.conc.equity_top10 >= 6
      ? `<span class="lg-name">${esc(companyName(f.conc.top1.name))}</span> <b>${pctSign(fx(f.conc.top1.weight, 1))}</b>` : "—";
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
  if (c.id === "top10") return !f.conc;
  if (c.id === "largest") return !(f.conc && f.conc.equity_top10 >= 6);
  if (c.expo) return !(f.exposures[c.expo] || []).length;
  return false;
}

// ================================================================== URL state

// URL key -> state key. The first nine predate the table filters; keep them so old bookmarks work.
const URL_NUMS = {
  si: "minSI", six: "maxSI", r5: "min5", r5x: "max5", r10: "min10", r10x: "max10", age: "minAge", fee: "maxFee", aum: "minAum",
  r1: "min1", r1x: "max1", r3: "min3", r3x: "max3", agex: "maxAge", feen: "minFee", aumx: "maxAum", yr: "minYear", yrx: "maxYear",
  yl: "minYield", ylx: "maxYield", t10: "minTop10", t10x: "maxTop10",
};

function saveUrl() {
  const p = new URLSearchParams();
  if (S.q) p.set("q", S.q);
  if (S.types.length) p.set("a", S.types.join(","));
  if (S.geos.length) p.set("g", S.geos.join(","));
  if (S.sectors.length) p.set("sec", S.sectors.join(";"));
  if (S.xtypes.length) p.set("xa", S.xtypes.join(","));
  if (S.xgeos.length) p.set("xg", S.xgeos.join(","));
  if (S.xsectors.length) p.set("xsec", S.xsectors.join(";"));
  if ((S.sectors.length || S.xsectors.length) && S.sectorMin !== DEFAULT_SECTOR_MIN) p.set("sm", S.sectorMin);
  for (const [k, key] of Object.entries(URL_NUMS)) if (S[key] != null) p.set(k, S[key]);
  if (S.basis !== "nav") p.set("b", S.basis);
  if (S.exps.length) p.set("x", S.exps.map((e) => [e.dim, e.label, e.min ?? "", e.op === "le" ? "le" : ""].join("|")).join(";"));
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
  S.xtypes = list("xa");
  S.xgeos = list("xg").filter((g) => GEO_TESTS[g]);
  S.xsectors = list("xsec", ";");
  if (p.has("sm")) S.sectorMin = Number(p.get("sm"));
  for (const [k, key] of Object.entries(URL_NUMS)) S[key] = p.has(k) && p.get(k) !== "" && isNum(Number(p.get(k))) ? Number(p.get(k)) : null;
  S.basis = p.get("b") === "price" ? "price" : "nav";
  S.exps = list("x", ";").map((s) => {
    const [dim, label, min, op] = s.split("|");
    return { dim, label, min: min === "" || min == null ? null : Number(min), op: op === "le" ? "le" : "ge" };
  });
  S.sort = list("s").map((s) => { const [key, d] = s.split(":"); return { key, dir: Number(d) === 1 ? 1 : -1 }; })
    .filter((r) => SORTS[r.key]);
  if (!S.sort.length) S.sort = structuredClone(DEFAULT_SORT);
  S.cmp = list("c");
  S.view = p.get("v") === "cards" ? "cards" : "table";
}

// ================================================================== filtering + sorting

// Search: accent-insensitive, every word must match, and longer words match by their stem so Czech
// endings don't matter ("japonsko" finds "japonských", "zlato" finds "zlata").
const fold = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function matchesSearch(f, q) {
  f._hay ??= fold([f.ticker, f.name, f.isin, f.cusip, f.description, f.description_cs].join(" "));
  return fold(q).split(/\s+/).filter(Boolean).every((w) => {
    const stem = w.length > 4 ? w.slice(0, Math.max(4, w.length - 2)) : w;
    // match from the start of a word, so "eden" doesn't hit "Sweden"
    return new RegExp("(^|[^a-z0-9])" + stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(f._hay);
  });
}

function passes(f) {
  if (S.q && !matchesSearch(f, S.q)) return false;
  // within a category: OR
  if (S.types.length && !S.types.includes(f.asset_class)) return false;
  if (S.geos.length && !S.geos.some((g) => GEO_TESTS[g](f))) return false;
  if (S.sectors.length && !S.sectors.some((s) => expo(f, "sector", s) >= (S.sectorMin ?? 0.0001))) return false;
  // excluded options: a fund matching any of them is dropped
  if (S.xtypes.includes(f.asset_class)) return false;
  if (S.xgeos.some((g) => GEO_TESTS[g](f))) return false;
  if (S.xsectors.some((s) => expo(f, "sector", s) >= (S.sectorMin ?? 0.0001))) return false;
  // across categories: AND
  for (const [lo, hi, get] of Object.values(RANGES)) {
    if (S[lo] == null && S[hi] == null) continue;
    const v = get(f);
    if (!isNum(v)) return false;          // missing data (e.g. no 10y history) never passes
    if (S[lo] != null && v < S[lo]) return false;
    if (S[hi] != null && v > S[hi]) return false;
  }
  for (const e of S.exps) {
    if (e.op === "le") {   // "at most": needs the breakdown to exist, otherwise we can't tell
      if (!(f.exposures[e.dim] || []).length || expo(f, e.dim, e.label) > (e.min ?? 0)) return false;
    } else if (expo(f, e.dim, e.label) < (e.min ?? 0.0001)) return false;
  }
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

// Include/exclude per option: off -> include -> exclude -> off.
const TRI = { type: ["types", "xtypes"], geo: ["geos", "xgeos"], sector: ["sectors", "xsectors"] };
function triState(kind, v) {
  const [inc, exc] = TRI[kind];
  return S[inc].includes(v) ? "in" : S[exc].includes(v) ? "out" : "";
}
function setTri(kind, v, state) {
  const [inc, exc] = TRI[kind];
  S[inc] = S[inc].filter((x) => x !== v);
  S[exc] = S[exc].filter((x) => x !== v);
  if (state === "in") S[inc].push(v);
  if (state === "out") S[exc].push(v);
}
const nextTri = (st) => (st === "" ? "in" : st === "in" ? "out" : "");

function chipHtml(kind, value, label) {
  const st = triState(kind, value);
  const said = st === "in" ? t("included") : st === "out" ? t("excluded") : "";
  return `<button class="chip" data-${kind}="${esc(value)}" data-state="${st}" aria-pressed="${st === "in" ? "true" : st === "out" ? "mixed" : "false"}"
    aria-label="${esc(label)}${said ? `: ${esc(said)}` : ""}" title="${esc(t("triHint"))}">${esc(label)}</button>`;
}

function renderFilterControls() {
  const present = new Set(FUNDS.map((f) => f.asset_class));
  $("fTypes").innerHTML = TYPE_KEYS.filter((v) => present.has(v)).map((v) => chipHtml("type", v, typeName(v))).join("");
  $("fGeos").innerHTML = Object.keys(GEO_TESTS).map((k) => chipHtml("geo", k, L().geos[k])).join("");
  const chipSectors = [...new Set([...SECTOR_COMMON, ...S.sectors, ...S.xsectors])];
  $("fSectors").innerHTML = chipSectors.map((s) => chipHtml("sector", s, sectorName(s))).join("");
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
      <select data-k="op" class="exp-op" aria-label="${esc(t("expOp"))}">
        <option value="ge" ${e.op !== "le" ? "selected" : ""}>≥</option><option value="le" ${e.op === "le" ? "selected" : ""}>≤</option></select>
      <input data-k="min" type="number" min="0" max="100" step="1" value="${e.min ?? ""}" placeholder="%" aria-label="%">
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
  if (S.xtypes.length) out.push({ col: "type", out: true, label: `${t("chipXAsset")}: ${S.xtypes.map(typeName).join(", ")}`, clear: () => { S.xtypes = []; } });
  if (S.xgeos.length) out.push({ col: "geo", out: true, label: `${t("chipXGeo")}: ${S.xgeos.map((g) => L().geos[g]).join(", ")}`, clear: () => { S.xgeos = []; } });
  if (S.xsectors.length) out.push({ col: "sector", out: true, label: `${t("chipXSector")}: ${S.xsectors.map(sectorName).join(", ")} ≥ ${pct(S.sectorMin ?? 0)}`, clear: () => { S.xsectors = []; } });
  for (const [col, [lo, hi, , kind]] of Object.entries(RANGES)) {
    const name = sortLabel(col);
    if (S[lo] != null) out.push({ col, label: `${name} ≥ ${rangeValue(kind, S[lo])}`, clear: () => { S[lo] = null; } });
    if (S[hi] != null) out.push({ col, label: `${name} ≤ ${rangeValue(kind, S[hi])}`, clear: () => { S[hi] = null; } });
  }
  S.exps.forEach((e) => out.push({
    label: `${labelName(e.dim, e.label)} ${e.op === "le" ? "≤" : "≥"} ${pct(e.min ?? 0)}`, clear: () => { S.exps = S.exps.filter((x) => x !== e); },
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
    `<span class="achip${a.out ? " out" : ""}">${esc(a.label)}<button data-clear="${i}" aria-label="${esc(t("removeFilter", a.label))}">×</button></span>`).join("") +
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
    const funnel = !(RANGES[c.id] || ["etf", "type", "geo", "sector"].includes(c.id)) ? "" : `<button class="thf ${on ? "on" : ""}" data-filter="${c.id}" aria-haspopup="dialog" aria-expanded="${popCol === c.id}"
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
      ${fundDesc(f) ? `<p class="desc">${esc(fundDesc(f))}</p>` : ""}
      <div class="big"><div class="label">${esc(h.label)}</div><div class="v">${fmtBig(h.v)}</div></div>
      <div class="facts">
        <div><div class="label">${esc(t("cost"))}</div><div class="v">${fmtPct(f.expense_ratio)}</div></div>
        <div><div class="label">${esc(t("ageL"))}</div><div class="v">${fmtAge(a)}</div></div>
        <div><div class="label">${esc(t("sizeL"))}</div><div class="v">${fmtAum(f.net_assets)}</div></div>
      </div>
    </article>`;
  }).join("");
}

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
  const ny = marketState(MARKETS[0], new Date());
  const when = ny.open ? t("closesIn", dur(ny.mins)) : t("opensIn", dur(ny.mins));
  $("nyStatus").innerHTML = `<span class="sdot ${ny.open ? "open" : ""}"></span>${t("mktPill", ny.open)}<span class="mkt-when"> · ${esc(when)}</span>`;
  $("nyStatus").title = t("hoursNote");
}

// ================================================================== intro: promise, one button, a real example

function goToScreener(focusSearch = false) {
  $("etfs").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
  if (focusSearch) setTimeout(() => $("q").focus({ preventScroll: true }), reducedMotion.matches ? 0 : 450);
}
document.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-goto='etfs']")) goToScreener(ev.target.closest(".cta") != null);
});

function renderIntro() {
  if (!FUNDS.length) return;
  const d = META.imported_at ? new Date(META.imported_at) : null;
  const date = d ? d.toLocaleDateString(LANG === "cs" ? "cs-CZ" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  $("introMeta").textContent = t("introMeta", FUNDS.length, date);
}

// ================================================================== intro background: what's inside, drifting

// Names of companies held by a few broad funds float slowly behind the headline. Bigger holdings are
// larger and nearer; names fade out around the text so it always stays readable.
const FIELD_FUNDS = ["IVV", "IEFA", "IEMG", "IJH", "IJR", "ACWI"];
const field = { items: [], ctx: null, w: 0, h: 0, raf: 0, visible: true, mx: 0, my: 0, t0: 0 };

async function startField() {
  const canvas = $("introBg"); if (!canvas || !canvas.getContext) return;
  const lists = await Promise.all(FIELD_FUNDS.map(async (tk) => { await loadHoldings(tk); return HOLDINGS[tk]; }));
  const seen = new Set(), names = [];
  for (const data of lists) {
    if (!data || data === "missing") continue;
    for (const h of data.holdings) {
      if (h.asset_class && h.asset_class !== "Equity") continue;
      const name = (h.about?.label || titleCase(h.name)).replace(/,?\s+(Inc\.?|Corp\.?|Corporation|plc|PLC|N\.V\.|S\.A\.|SA|AG|SE|Ltd\.?|Class [A-Z])$/i, "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name); names.push({ name, w: h.weight });
    }
  }
  if (!names.length) return;
  field.names = names;                      // biggest holdings first (files are sorted by weight)
  field.ctx = canvas.getContext("2d");
  const resize = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    field.w = r.width; field.h = r.height;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    field.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layoutField();
    drawField(performance.now());
  };
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { field.visible = e.isIntersecting; loopField(); }).observe(canvas);
  document.addEventListener("visibilitychange", loopField);
  reducedMotion.addEventListener?.("change", loopField);
  addEventListener("pointermove", (ev) => {
    field.mx = (ev.clientX / innerWidth - 0.5); field.my = (ev.clientY / innerHeight - 0.5);
  }, { passive: true });
  new MutationObserver(() => drawField(performance.now())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  resize();
  loopField();
}

function loopField() {
  cancelAnimationFrame(field.raf);
  if (!field.visible || document.hidden || reducedMotion.matches) return;   // still frame when paused
  const step = (now) => { drawField(now); field.raf = requestAnimationFrame(step); };
  field.raf = requestAnimationFrame(step);
}

// Calm horizontal lanes: each lane drifts at its own depth and speed, names in a lane never overlap.
function layoutField() {
  const { w, h, names } = field; if (!w || !names) return;
  const ctx = field.ctx, laneCount = Math.max(6, Math.round(h / 62));
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lanes = Array.from({ length: laneCount }, (_, i) => {
    const z = 0.3 + 0.7 * rnd();
    return { y: (i + 0.5) / laneCount + (rnd() - 0.5) * 0.25 / laneCount, z, size: 12 + 16 * z,
      speed: 6 + 16 * z, dir: i % 2 ? -1 : 1, items: [], len: 0 };
  });
  // nearer lanes get the bigger holdings
  const byDepth = [...lanes].sort((a, b) => b.z - a.z);
  const perLane = Math.max(3, Math.ceil((w / 340)));
  names.slice(0, perLane * laneCount).forEach((n, i) => byDepth[i % laneCount].items.push({ text: n.name }));
  for (const lane of lanes) {
    ctx.font = `${lane.z > 0.75 ? 600 : 500} ${lane.size.toFixed(1)}px Inter, system-ui, sans-serif`;
    let x = rnd() * 200;
    for (const it of lane.items) { it.off = x; x += ctx.measureText(it.text).width + 140 + rnd() * 160; }
    lane.len = Math.max(x, w + 400);
  }
  field.lanes = lanes;
}

function drawField(now) {
  const { ctx, w, h, lanes } = field; if (!ctx || !w || !lanes) return;
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#111";
  const t = reducedMotion.matches ? 0 : now / 1000;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = ink;
  ctx.textBaseline = "middle";
  // the quiet zone around the headline and button: wide on phones, an ellipse on desktop
  const cx = w / 2, cy = h * 0.5, rx = Math.max(w * 0.47, Math.min(w * 0.36, 560)), ry = h * 0.4;
  for (const lane of lanes) {
    ctx.font = `${lane.z > 0.75 ? 600 : 500} ${lane.size.toFixed(1)}px Inter, system-ui, sans-serif`;
    const py0 = lane.y * h - field.my * 16 * lane.z;
    for (const it of lane.items) {
      const shift = (t * lane.speed * lane.dir) % lane.len;
      const px = ((it.off + shift) % lane.len + lane.len) % lane.len - 200 - field.mx * 24 * lane.z;
      const d = Math.hypot((px - cx) / rx, (py0 - cy) / ry);
      const calm = Math.min(1, Math.max(0, (d - 0.85) / 0.5));
      const edge = Math.max(0, Math.min(1, py0 / 70, (h - py0) / 90));
      const alpha = (0.03 + 0.075 * lane.z) * calm * edge;
      if (alpha < 0.004) continue;
      ctx.globalAlpha = alpha;
      ctx.fillText(it.text, px, py0);
    }
  }
  ctx.globalAlpha = 1;
}

// ================================================================== theme: off-white by default, dark on request

const theme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
function renderThemeBtn() {
  const label = t(theme() === "dark" ? "toLight" : "toDark");
  $("themeBtn").setAttribute("aria-label", label);
  $("themeBtn").title = label;
}
$("themeBtn").addEventListener("click", () => {
  document.documentElement.dataset.theme = theme() === "dark" ? "light" : "dark";
  lsSet("fs.theme", theme());
  renderThemeBtn();
});

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
    else if (k === "op") e.op = el.value === "le" ? "le" : "ge";
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
  const kind = ["type", "geo", "sector"].find((k) => k in d);
  if (kind) setTri(kind, d[kind], nextTri(triState(kind, d[kind])));
  else if ("q" in d) { const k = b.parentElement.dataset.for; S[k] = Number(d.q); $(k).value = d.q; }
  else if (b.closest("#basis")) S.basis = d.v;
  else if (d.k === "rm") { S.exps.splice(+b.closest(".exp").dataset.i, 1); renderExps(); }
  else if (b.id === "addExp") {
    S.exps.push({ dim: "region", label: (DIMS.region || []).includes("Europe") ? "Europe" : (DIMS.region || [""])[0], min: 50, op: "ge" });
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
  const r = a.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  // open upwards when there isn't room below the header
  const below = r.bottom + 8, above = r.top - 8 - h;
  pop.style.top = `${Math.round(below + h > innerHeight - 8 && above > 8 ? above : Math.min(below, Math.max(8, innerHeight - h - 8)))}px`;
  pop.style.left = `${Math.round(Math.min(Math.max(8, r.right - w), innerWidth - w - 8))}px`;
}

const ICON_IN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/></svg>';
function triList(kind, items) {
  return `<div class="ptri" role="list">${items.map(([v, label]) => {
    const st = triState(kind, v);
    return `<div class="ptri-row ${st}" role="listitem"><span class="ptri-label">${esc(label)}</span>
      <button class="ptri-btn in" data-tri="${kind}" data-v="${esc(v)}" data-to="in" aria-pressed="${st === "in"}" aria-label="${esc(t("include"))}: ${esc(label)}" title="${esc(t("include"))}">${ICON_IN}</button>
      <button class="ptri-btn out" data-tri="${kind}" data-v="${esc(v)}" data-to="out" aria-pressed="${st === "out"}" aria-label="${esc(t("exclude"))}: ${esc(label)}" title="${esc(t("exclude"))}">${ICON_OUT}</button>
    </div>`;
  }).join("")}</div>`;
}

function popBody(id) {
  if (id === "etf") {
    return `<label class="pfield">${esc(t("contains"))}<input type="search" data-pk="q" value="${esc(S.q)}" placeholder="${esc(t("searchShort"))}"></label>`;
  }
  if (id === "type") {
    const present = new Set(FUNDS.map((f) => f.asset_class));
    return `<p class="phint">${esc(t("triPopHint"))}</p>` + triList("type", TYPE_KEYS.filter((k) => present.has(k)).map((k) => [k, typeName(k)]));
  }
  if (id === "geo") {
    return `<p class="phint">${esc(t("triPopHint"))}</p>` + triList("geo", Object.keys(GEO_TESTS).map((k) => [k, L().geos[k]]));
  }
  if (id === "sector") {
    const items = [...new Set([...SECTOR_COMMON, ...S.sectors, ...S.xsectors])].map((k) => [k, sectorName(k)]);
    return `<p class="phint">${esc(t("triPopHint"))}</p>` + triList("sector", items) +
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
  else if (id === "type") { S.types = []; S.xtypes = []; }
  else if (id === "geo") { S.geos = []; S.xgeos = []; }
  else if (id === "sector") { S.sectors = []; S.xsectors = []; }
  else if (RANGES[id]) { S[RANGES[id][0]] = null; S[RANGES[id][1]] = null; }
}

$("colPop").addEventListener("input", (ev) => {
  const el = ev.target, d = el.dataset;
  if (d.pk === "q") S.q = el.value.trim();
  else if (d.pk) S[d.pk] = el.value.trim() === "" || !isNum(Number(el.value)) ? null : Number(el.value);
  else return;
  syncPanel();
  update(true);
  placePop();
});
$("colPop").addEventListener("click", (ev) => {
  const tri = ev.target.closest("[data-tri]");
  if (tri) {
    const { tri: kind, v, to } = tri.dataset;
    setTri(kind, v, triState(kind, v) === to ? "" : to);
    syncPanel(); update(true);
    const id = popCol, focusKey = `[data-tri="${kind}"][data-v="${CSS.escape(v)}"][data-to="${to}"]`;
    openPop(id); $("colPop").querySelector(focusKey)?.focus();
    return;
  }
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

// ------------------------------------------------------------------ "In short": what the fund depends on, in plain words

function glanceHtml(f) {
  const c = f.conc, rows = [];
  const top = (dim) => (f.exposures[dim] || [])[0];
  const isCompanies = c && c.equity_top10 >= 6;
  let verdict = null, bar = "";
  if (c) {
    const level = isCompanies && (c.top1.weight >= 15 || c.top10 >= 60) ? "high" : c.top10 >= 35 ? "mid" : "low";
    verdict = { level, label: t(`conc_${level}`) };
    const first = isCompanies ? c.top1.weight : 0, next = Math.max(0, c.top10 - first), rest = Math.max(0, 100 - c.top10);
    bar = `<div class="cbar" role="img" aria-label="${esc(t("concAria", pctSign(fx(c.top10, 0))))}">
        ${first ? `<span class="c1" style="width:${first}%"></span>` : ""}<span class="c2" style="width:${next}%"></span><span class="c3" style="width:${rest}%"></span>
      </div>
      <div class="clegend">
        ${first ? `<span><i class="c1"></i>${esc(companyName(c.top1.name))} ${pctSign(fx(first, 1))}</span>` : ""}
        <span><i class="c2"></i>${esc(first ? t("concNext9") : t("concTop10"))} ${pctSign(fx(next, 1))}</span>
        <span><i class="c3"></i>${esc(t("concRest", fmtInt(Math.max(0, (c.count || 0) - 10))))} ${pctSign(fx(rest, 1))}</span>
      </div>`;
    if (isCompanies && c.top1.weight >= 10) rows.push({ warn: true, text: t("glanceOneCo", esc(companyName(c.top1.name)), pctSign(fx(c.top1.weight, 1))) });
    rows.push({ text: isCompanies ? t("glanceCompanies", c.count, fmtInt(c.count), pctSign(fx(c.top10, 0))) : t("glancePositions", c.count, fmtInt(c.count), pctSign(fx(c.top10, 0))) });
  }
  const sec = top("sector");
  if (sec) rows.push({ text: t("glanceSector", esc(sectorName(sec[0])), pctSign(fx(sec[1], 0))) });
  const ctry = top("country");
  if (ctry) rows.push({ text: ctry[1] >= 99.5 ? t("glanceOneCountry", esc(countryName(ctry[0]))) : t("glanceCountry", esc(countryName(ctry[0])), pctSign(fx(ctry[1], 0))) });
  if (isNum(f.expense_ratio)) rows.push({ text: t("glanceCost", pctSign(fx(f.expense_ratio, 2)), fmtMoney(f.expense_ratio * 100)) });
  if (!rows.length) return "";
  return `<section class="glance" aria-labelledby="glanceH">
    <div class="glance-head"><h3 id="glanceH">${esc(t("inShort"))}</h3>${verdict ? `<span class="verdict ${verdict.level}">${esc(verdict.label)}</span>` : ""}</div>
    ${bar}
    <ul class="glance-list">${rows.map((r) => `<li class="${r.warn ? "warn" : ""}">${r.text}</li>`).join("")}</ul>
    ${c ? `<p class="note">${esc(t("concNote", fmtDate(c.as_of) || "?"))}</p>` : ""}
  </section>`;
}
// 3 -> "3", 53 -> "53", 0.5 -> "0.50" (cost per 10,000 invested)
const fmtInt = (n) => Number(n || 0).toLocaleString(LANG === "cs" ? "cs-CZ" : "en-US");
const fmtMoney = (v) => dec(v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(2));

function exposureSections(f) {
  const order = ["region", "country", "sector", "maturity", "rating"];
  const dims = Object.keys(f.exposures).sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)));
  if (!dims.length) return `<div class="section-h"><h3>${esc(t("whatHolds"))}</h3></div><p class="muted small">${esc(t("noBreakdown"))}</p>`;
  return dims.map((d) => {
    const list = f.exposures[d];
    const notes = [];
    if (d === "region") notes.push(t("fromCountries"));
    if ((d === "region" || d === "country") && f.country_assumed) notes.push(t("assumed100"));
    if (f.exposures_as_of[d]) notes.push(t("asOf", fmtDate(f.exposures_as_of[d])));
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

function companyName(raw) {
  const s = /[a-z]/.test(raw) ? raw : titleCase(raw);
  return s.replace(/\s+(Class|Cl)\s+[A-Z]$/i, "")
    .replace(/,?\s+(Inc\.?|Corp\.?|Corporation|Company|Co\.?|plc|PLC|N\.?V\.?|S\.?A\.?|AG|SE|ASA|AB|Ltd\.?|Holdings?|Group)$/i, "").trim() || s;
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
  const meta = [h.ticker && h.ticker !== "-" ? h.ticker : null, h.country && countryName(h.country),
    h.maturity ? t("matures", fmtDate(h.maturity)) : null, h.coupon ? t("coupon", pctSign(dec(h.coupon))) : null].filter(Boolean);
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
  return head(esc([t("positions", fmtInt(data.count)), data.as_of ? t("asOf", fmtDate(data.as_of)) : ""].filter(Boolean).join(" · "))) +
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
    ${glanceHtml(f)}
    ${fundDesc(f) ? `<div class="bubble"><p lang="${LANG === "cs" && f.description_cs ? "cs" : "en"}">${esc(fundDesc(f))}${t("descNote") ? `<span class="descnote" lang="${LANG}">${esc(t("descNote"))}</span>` : ""}</p></div>` : ""}

    <div class="dhero">
      <div class="label">${isNum(si) ? esc(t("annSince", f.inception_date.slice(0, 4))) : esc(t("tooNewAnn"))}</div>
      <div class="v">${fmtBig(si)}</div>
      <div class="periods">
        ${["1y", "3y", "5y", "10y"].map((p) => `<div><div class="label">${esc(L().periodShort[p])}</div><div class="v">${fmtBig(ret(f, p))}</div></div>`).join("")}
      </div>
    </div>

    <div class="facts-grid">
      ${fact(t("expense"), fmtPct(f.expense_ratio), esc(t("perYearS")))}
      ${fact(t("fundSize"), fmtAum(f.net_assets), f.net_assets_as_of ? esc(t("asOf", fmtDate(f.net_assets_as_of))) : "")}
      ${fact(t("ageL"), fmtAge(a), f.inception_date ? esc(t("launchedOn", fmtDate(f.inception_date))) : "")}
      ${fact(t("fAsset"), esc(typeName(f.asset_class)), esc(subAssetName(f.sub_asset_class)))}
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

    <div class="section-h"><h3>${esc(t("returns"))}</h3><span class="asof">${esc(basisLabel())} · ${esc(t("asOf", fmtDate(asOf) || "?"))}</span></div>
    <table class="mini"><thead><tr><th>${esc(t("periodL"))}</th><th class="num">${esc(t("annualized"))}</th><th class="num">${esc(t("cumulative"))}</th></tr></thead><tbody>${retRows}</tbody></table>
    <p class="note">${esc(t("cumNote"))}</p>

    <div class="section-h"><h3>${esc(t("sources"))}</h3></div>
    <dl class="kv">
      <dt>${esc(t("productPage"))}</dt><dd><a href="${esc(f.product_url)}" target="_blank" rel="noopener">ishares.com ↗</a></dd>
      <dt>${esc(t("factsheet"))}</dt><dd>${f.factsheet_url ? `<a href="${esc(f.factsheet_url)}" target="_blank" rel="noopener">PDF ↗</a>` : esc(t("notFound"))}</dd>
      <dt>${esc(t("navAsOf"))}</dt><dd>${esc(fmtDate(f.nav_returns_as_of) || "—")}</dd>
      <dt>${esc(t("priceAsOf"))}</dt><dd>${esc(fmtDate(f.price_returns_as_of) || "—")}</dd>
      <dt>${esc(t("sizeAsOf"))}</dt><dd>${esc(fmtDate(f.net_assets_as_of) || "—")}</dd>
      <dt>${esc(t("fetched"))}</dt><dd>${esc(fmtDate(f.page_fetched_at) || "—")}</dd>
      <dt>ISIN / CUSIP</dt><dd>${esc(f.isin || "—")} / ${esc(f.cusip || "—")}</dd>
      <dt>${esc(t("netGross"))}</dt><dd>${fmtPct(f.expense_ratio)} / ${fmtPct(f.gross_expense_ratio)}</dd>
    </dl>
    <p class="note">${esc(t("snapNote", fmtDate(META.imported_at)))}</p>`;

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
        <tr><th>${esc(t("whatItDoes"))}</th>${fs.map((f) => `<td class="desc-cell">${esc(fundDesc(f) || "—")}</td>`).join("")}</tr>
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
  renderIntro();
  startField();
  window.addEventListener("hashchange", load);
  if (location.hash.length > 1) requestAnimationFrame(() => $("etfs").scrollIntoView({ block: "start" }));
}
init();
