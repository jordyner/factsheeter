# Factsheeter — App Description

> **Know what's inside your next ETF.** A fast, visual screener for iShares ETFs: filter and sort ~480 funds by return, cost, age and exposure, then open any fund to see what it actually owns and what those companies do.

**Status:** working prototype, runs locally · **Version described:** branch `main` · **Data snapshot:** holdings as of 1 October 2026 · **Funds covered:** 482 US-listed iShares ETFs · **Languages:** English, Czech

---

## Contents

1. [What Factsheeter is](#1-what-factsheeter-is)
2. [Who it is for](#2-who-it-is-for)
3. [What you can do with it](#3-what-you-can-do-with-it)
4. [A tour of the page](#4-a-tour-of-the-page)
5. [The fund detail panel](#5-the-fund-detail-panel)
6. [Comparing funds](#6-comparing-funds)
7. [Data: where it comes from and what it means](#7-data-where-it-comes-from-and-what-it-means)
8. [How it is built](#8-how-it-is-built)
9. [Visual design](#9-visual-design)
10. [Languages and formatting](#10-languages-and-formatting)
11. [Running, updating and deploying](#11-running-updating-and-deploying)
12. [Quality checks](#12-quality-checks)
13. [Legal, licensing and disclaimers](#13-legal-licensing-and-disclaimers)
14. [Known limitations](#14-known-limitations)
15. [Roadmap and ideas](#15-roadmap-and-ideas)
16. [Glossary](#16-glossary)

---

## 1. What Factsheeter is

Factsheeter turns hundreds of separate iShares fund pages and PDF factsheets into **one searchable, sortable table**. Instead of opening fund after fund on ishares.com, you see every fund's key numbers side by side, narrow the list with filters, and click a fund to see its details — including **which companies it holds and what those companies do**.

It answers questions like:

- *Which funds have existed for 10+ years, returned at least 7 % a year since launch and cost under 0.30 % a year?*
- *Which stock ETFs avoid emerging markets and have little in energy?*
- *What does this fund actually hold, and what do its biggest companies make?*

Every number keeps its **as-of date** and links back to the **iShares product page and factsheet**, so you can always verify it at the source.

### The problem it solves

Fund providers publish data fund by fund. Comparing even five ETFs means reading five factsheets and keeping the numbers in your head. Factsheeter gathers the data once, keeps it consistent (same units, same periods, same definitions) and makes comparison immediate. Its distinguishing feature is the look *inside* a fund: holdings explained in plain language.

---

## 2. Who it is for

- **Individual investors** choosing an ETF to buy, who want to compare cost, track record and exposure without reading dozens of PDFs.
- **People new to ETFs**, who benefit from plain explanations (what a fund holds, what each company does, annualized vs cumulative returns).
- **Czech-speaking users**: the whole interface, every fund description and every company description are available in natural Czech (written for readers, not translated word for word).

The first goal is personal research; a public or paid version is a possible later step (see [Legal](#13-legal-licensing-and-disclaimers)).

---

## 3. What you can do with it

| You want to… | How |
|---|---|
| Understand what the site is | The intro explains it in one headline and two sentences |
| Get to the funds | **Explore ETFs ↓** (or **ETF screener** in the top bar) scrolls to the table |
| Find a specific fund | Type a name, ticker, ISIN or topic (*dividend*, *Japan*, *gold*) in the search box |
| Narrow the list | Use the funnel in any column header, or the **Filters** panel |
| Leave something out | Click an option twice to **exclude** it (e.g. exclude Bonds or Emerging markets) |
| See what is filtered | Every active filter appears as a removable **tag** (exclusions in red); "Clear all" resets them |
| Rank funds | Click a column header; **Shift-click** another to add a tie-breaker, or use **+ Add sort** |
| Show more or fewer columns | **Columns** menu (remembered in your browser) |
| Understand a fund | Click its row → side panel with returns, costs, holdings, sectors, regions, sources |
| Learn what the companies do | In the side panel, expand a holding (or "Show what they do") |
| Compare funds | Tick up to **6** funds → **Compare** |
| Share or bookmark a search | The link stores filters, exclusions, sorting, view and compare selection; it opens straight at the results |
| Switch language | **EN / CS** in the top bar |
| Switch light / dark | The moon / sun button in the top bar (remembered) |
| Browse visually | **Cards** view instead of the table |

---

## 4. A tour of the page

From top to bottom:

### 4.1 Top bar
- **FACTSHEETER** logo.
- A tiny **NYSE status pill**: "● NYSE closed · opens in 1d 6h" (green dot when open). Regular trading hours only; exchange holidays are not included.
- **ETF screener** link (scrolls to the table).
- **EN / CS** language switch.
- **Theme switch** (moon / sun icon): off-white light mode by default, dark mode on request, choice remembered.

### 4.2 Intro (first screen)
A calm, almost full-screen typographic opening, shown on every visit:

- Headline: **"Know what's inside your next ETF."**
- Two plain sentences: *"Compare iShares ETFs by return, fees and how long they've been around. Then look inside: which companies each fund owns, and what they do."*
- One primary button: **Explore ETFs ↓** — scrolls smoothly to the screener.
- A meta line generated from the data: *"482 US-listed ETFs · English / Čeština · Data from 3 Oct 2026"*.
- **Animated background:** names of real companies held by six broad iShares funds (IVV, IEFA, IEMG, IJH, IJR, ACWI) drift slowly sideways in calm horizontal lanes, very faint; bigger holdings are drawn larger and nearer. The area around the headline and button stays clear, names react slightly to the mouse, the animation pauses when off-screen or in a background tab, and it stays still for users with "reduce motion" turned on.
- The intro fills about 80–90 % of the first screen; the top edge of the search bar peeks in at the bottom so it is obvious the tool continues below.
- **Shared links that contain filters skip the intro** and open directly at the results.

### 4.3 Toolbar
- **Search** — matches ticker, name, ISIN, CUSIP and the fund description.
- **Filters** — opens the full filter panel; a badge shows how many filters are active.
- **Columns** — choose which columns are visible.
- **Result count** — e.g. "236 of 482 ETFs".
- **Table / Cards** — switch views.

### 4.4 Filter tags and sort rules
Under the toolbar:
- **Filters:** each active filter as a tag joined by "and", e.g. `Asset class: Stocks` and `Exclude geography: Emerging markets` and `Exclude sector: Energy ≥ 20%`. Exclusions are tinted red. Click **×** to remove one, **Clear all** to remove all.
- **Sort:** the ordered sort rules, e.g. `1. Fund size ↓ high → low`, each with a direction toggle and a remove button, plus **+ Add sort**.

### 4.5 The table
The main working area. The header row and the ETF column stay fixed while scrolling.

**Default columns**

| Column | Meaning |
|---|---|
| ETF | Rank, compare checkbox, ticker and name ("new" badge if under 5 years old) |
| Since launch *(ann.)* | Average yearly return since the fund started |
| Age *(yrs)* | Years since launch |
| Launched | Launch date |
| 5y *(ann.)*, 10y *(ann.)* | Average yearly return over the last 5 / 10 years |
| Geography | Coloured bar of region weights + top two regions |
| Sectors | Top two sectors with weights |
| Expense ratio | Yearly cost of the fund |
| Top 10 | How much of the fund its 10 largest positions make up |

**Optional columns:** 1y, 3y *(ann.)*, Largest holding, Size (fund assets), Asset class, Yield (trailing 12 months).

**Reading the table**
- Positive returns are green, negative red, with a thin bar under each return showing its size. A **"—" means no data** (for example, a 3-year-old fund has no 10-year return), never zero.
- Clicking a geography or sector summary opens the side panel scrolled to that full breakdown.
- Hovering a row highlights it; clicking opens the side panel.

### 4.6 Column filters (funnel icons)
Every column header has a small funnel that opens a filter box for that column:

| Column type | Filter |
|---|---|
| Returns (since launch, 1y, 3y, 5y, 10y) | Min / max, % per year |
| Age | Min / max years |
| Launched | From year / to year |
| Expense ratio, Yield | Min / max % |
| Size | Min / max, $ millions |
| Asset class, Geography, Sectors | Each option has **✓ include** and **⊘ exclude** buttons |
| ETF | Text search |

A filtered column gets a filled funnel and an accent line under its header. The filter box opens upwards when there is no room below the header.

### 4.7 The Filters panel
The same filters in one place, plus a few extras:
- **Asset class** chips (Stocks, Bonds, Real estate, Commodities, Crypto, Mixed, Cash).
- **Geography** chips (US & Canada, Europe, Asia-Pacific, Latin America, Middle East & Africa, Global, Emerging markets).
- **Sector** chips with an "at least X % in the selected sector" threshold, plus a list of all other sectors.
- **Chips have three states:** click once to **include** (dark), twice to **exclude** (red, crossed out), a third time to clear.
- **Annualized return** min/max for since launch, 5 and 10 years, and a **Fund value (NAV) / Market price** switch.
- **Fund**: minimum age, maximum expense ratio, minimum size, with quick-pick buttons.
- **Exposure conditions**: precise rules on regions, countries, sectors, maturity or rating with **≥ or ≤**, e.g. *Europe ≥ 50 %* or *Japan ≤ 10 %*.

**How filters combine:** different filters must **all** match (AND). Several *included* options inside one filter mean **any** of them (OR). A fund matching **any excluded** option is removed. The panel explains this in a short note.

### 4.8 Cards view
An alternative to the table: one card per fund with ticker, name, short description, the headline return for the current sort period, and cost, age and size. Cards load 48 at a time ("Show more").

### 4.9 Compare bar
When funds are ticked, a floating bar at the bottom lists them and offers **Compare** (2–6 funds) or **Clear**.

---

## 5. The fund detail panel

Opens on the right when you click a fund. Sections, top to bottom:

1. **Ticker and full name.**
2. **Description** — iShares' own short summary of what the fund does; in Czech a hand-written Czech version (`translations/funds_cs.json`).
   **In short** — a plain-language concentration check: a verdict (spread out / fairly concentrated / concentrated), a three-part bar (largest company · next 9 · the rest) and a few one-line facts, e.g. *"Novo Nordisk alone is 19.4 % of the fund"*. Bond funds describe positions instead of companies.
3. **Headline return** — average yearly return since launch, with 1y, 3y, 5y and 10y underneath.
4. **Key facts** — expense ratio, fund size (with date), age and launch date, asset class, main region, yield (trailing 12 months).
5. **Actions** — add to compare, iShares product page, factsheet PDF.
6. **Top holdings**
   - The 10 largest positions with **weight**, ticker and country, plus how much of the fund the top 10 make up (e.g. "The largest 10 make up 38.9 % of the fund") and the total number of positions.
   - **What each company does**: collapsed by default. Click a company (or "Show what they do") to expand a one- or two-sentence description and tags for its main products or industry, with a link to Wikipedia. Example: *Nvidia — designs and supplies graphics processing units…; tags: GPU, chipset, software*. In Czech every description is hand-written Czech (`translations/companies_cs.json`).
   - **Show top 50** expands the list. Bond funds show maturity and coupon instead of a company description.
7. **Breakdowns** — regions, countries, sectors (and maturity / credit rating for bond funds), each as bars with percentages and an as-of date.
8. **Returns table** — annualized and **cumulative** return for 1, 3, 5, 10 years and since launch. Cumulative values are calculated from the annualized figures and labelled as such.
9. **Sources & dates** — product page, factsheet, NAV and market-price return dates, fund-size date, page fetch date, ISIN/CUSIP, net and gross expense ratio.

---

## 6. Comparing funds

The compare view puts 2–6 funds in columns:
- name and description,
- asset class, launch date, expense ratio, fund size,
- annualized returns for 1, 3, 5, 10 years and since launch,
- region weights and the top 12 sectors.

The **best value in each row is highlighted** (lowest cost, largest size, highest return). "—" means the fund has no data for that row (usually because it is younger than the period).

---

## 7. Data: where it comes from and what it means

### 7.1 Sources

| # | Source | What it provides |
|---|---|---|
| 1 | **iShares product-screener JSON** (one request) | Every fund's identifiers (ticker, ISIN, CUSIP), asset class, region, fees, inception date, fund size, 1/3/5/10-year and since-inception annualized returns (NAV and market price), yield |
| 2 | **Each fund's product page** | Exposure breakdowns (sectors, countries, maturity, rating) with as-of dates, the short fund description, the factsheet PDF link |
| 3 | **Each fund's holdings file** (`latest-holdings.csv`) | Every position with weight, sector, country, exchange; bonds also maturity and coupon |
| 4 | **Wikidata + Wikipedia** (English and Czech) | What each top-10 company does: a short description, main products and industry |

No PDFs are parsed; all figures come from structured data.

### 7.2 The data pipeline

```
iShares screener + product pages ──► importer/ishares_us.py ──► SQLite (data/factsheeter.db)
                                                          └──► web/data/funds.json, meta.json
iShares holdings files ──► importer/holdings.py ──► web/data/holdings/<TICKER>.json
Wikidata / Wikipedia ──► importer/companies.py ──► adds "about" to the holdings files
```

- **Polite fetching:** 3 requests at a time with pauses and retries; only www.ishares.com URLs are followed. Wikimedia requests are sequential, honour rate-limit hints and save progress, so an interrupted run resumes where it stopped.
- **Caching:** extracted data is cached per fund (`data/cache/`), so re-runs are fast and only `--refresh` refetches.

### 7.3 Current snapshot (holdings as of 1 October 2026)

| Item | Count |
|---|---|
| ETFs | 482 (290 equity, 154 bond, 17 multi-asset, 8 real estate, 7 commodity, 4 digital assets, 2 cash) |
| Funds with a holdings list | 479 (the gold/silver trusts hold metal and publish none) |
| Holding rows stored (top 50 per fund) | 21,517 |
| Distinct companies looked up (top 10 of every fund) | 1,107 |
| Companies matched to Wikipedia | 762 (69 %) |
| Holding rows with a description | 7,638 |
| … of which with Czech text | all of them |

### 7.4 Definitions

- **Annualized return** — average yearly growth over the period (geometric). This is what all return columns show.
- **Cumulative return** — total growth over the whole period, shown only in the side panel and calculated from the annualized figure.
- **NAV vs market price** — NAV is the value of the fund's holdings; market price is what the ETF traded at on the exchange. NAV is the default; the Filters panel switches the basis.
- **Expense ratio** — the net yearly cost (the gross figure is in the side panel's sources).
- **Age** — years since the fund's inception date. Funds under 5 years old get a "new" badge.
- **Regions** — calculated from country weights (a mapping in `importer/regions.py`). Single-country funds without a country table are assumed 100 % in their classified country, and this is labelled.
- **Missing data** — shown as "—", never as zero. Breakdowns that iShares publishes as all zeros are treated as missing. Return filters exclude funds that are too young for the period; "≤" exposure conditions only match funds that publish that breakdown.
- **Geography chips** — use iShares' main-region classification; for exact percentages use an exposure condition.
- **Sector include / exclude** — a fund counts as being "in" a sector when at least the chosen threshold (default 20 %) of it is in that sector.

### 7.5 Company descriptions: how matching works

1. **By ticker and exchange** in Wikidata (most reliable), checked against the company name.
2. **By name** among listed companies, as a fallback (slower; currently only partly run because of Wikidata rate limits).
3. From the matched article, the **first sentence that says what the company does** is kept (the legal name and pure "headquartered in…" sentences are trimmed; sentences about the stock listing are skipped). Products and industry come from Wikidata.
4. **Czech** text is hand-written per company in `translations/companies_cs.json` (keyed by Wikidata id) — rewritten for Czech readers, not translated word for word, with Czech context where useful (e.g. KBC owns ČSOB). Czech Wikipedia is only a fallback. `python -m importer.companies --merge-only` re-applies it offline.
5. Wrong matches are removed by hand in the cache (e.g. ATI, Lithium Americas), so a fund shows no description rather than a wrong one.

---

## 8. How it is built

### 8.1 Architecture

- **Importer (Python):** fetches, parses and normalizes data into SQLite and static JSON files.
- **Front end (plain HTML, CSS, JavaScript):** no framework and no build step. All filtering and sorting happens in the browser on the full dataset (~0.9 MB, ~155 kB compressed). Holdings load per fund only when needed (its panel, or the six funds used by the intro background).
- **Local server (FastAPI):** serves the page and data during development. Not needed in production: the site works as **pure static files**.

### 8.2 Project layout

```
factsheeter/
├── app/main.py              FastAPI app: /api/funds, /api/meta, serves web/
├── importer/
│   ├── ishares_us.py        screener + product pages → SQLite (+ static export)
│   ├── regions.py           country → region mapping
│   ├── holdings.py          holdings CSVs → web/data/holdings/<TICKER>.json
│   ├── companies.py         Wikidata/Wikipedia descriptions (EN + CS)
│   └── export_static.py     SQLite → web/data/funds.json, meta.json
├── web/
│   ├── index.html           page structure (top bar, intro, screener, panels)
│   ├── app.js               state, filtering, sorting, table, panel, compare, intro background
│   ├── i18n.js              all UI text in English and Czech (210 keys each)
│   ├── style.css            design (light/dark)
│   ├── img/                 earlier artwork, not used by the current page
│   └── data/                funds.json, meta.json, holdings/
├── build_site.py            builds the deployable static site into dist/
├── mascot/                  mascot source artwork (not used)
├── research/                data samples, design backups, screenshots, browser checks
├── data/                    SQLite database and caches (not in git)
├── README.md                setup and commands
└── APP_DESCRIPTION.md       this document
```

### 8.3 Front-end state

- All filters (including exclusions), the sort rules, the compare selection and the view are kept in one state object and mirrored in the **URL**, so any view can be bookmarked or shared.
- Column visibility, language, theme and whether the Filters panel is open are remembered in the browser (local storage).
- The interface text lives in `i18n.js` (210 keys per language, kept identical between English and Czech).

### 8.4 Stack

| Part | Technology |
|---|---|
| Importer | Python 3.14, httpx (async), SQLite |
| Local server | FastAPI + Uvicorn |
| Front end | HTML, CSS, vanilla JavaScript, Canvas 2D (intro background) |
| Fonts | Schibsted Grotesk (intro headline), Orbitron (logo, headings), Inter (text), Oxanium (table numbers) via Google Fonts |
| Tests | Playwright (headless Chromium) |
| Hosting (planned) | Static host, e.g. Vercel or Cloudflare Pages |

---

## 9. Visual design

- **Character:** typography first. The first screen is one large, calm headline on off-white paper with a faint, drifting field of company names — the "what's inside" idea in motion. The screener below keeps a technical feel: geometric labels, fine grid lines, monochrome ink with a single olive accent.
- **Typography:** Schibsted Grotesk (heavy, tightly set) for the intro headline; Orbitron for the logo, panel headings and big figures; Inter for text; Oxanium for compact numbers in the table.
- **Colour:** off-white paper (`#f5f3ed`) and near-black ink in light mode, which is the default; near-black background in dark mode, switched manually and remembered. Olive accent (`#56652d`, lighter in dark mode) for active states; green / rust for positive / negative returns; rust red also marks exclusions.
- **Motion:** one authored moment — the headline, text and button rise in gently on load — plus the slow background drift and small hover responses. Everything respects the system "reduce motion" setting.
- **Responsive:** works on phones — the intro stacks and keeps the button visible, background names stay at the edges, the ETF column narrows to the ticker, and there is no sideways page scrolling.
- **History:** earlier versions had a large New York market clock with five exchanges, a Manhattan skyline photo band, and a plush and later a graphite bull mascot. All were removed in favour of the typographic intro; their assets remain in `web/img/` and `mascot/`, and earlier layouts are kept in `research/design-backups/`.

---

## 10. Languages and formatting

- **English and Czech** for the whole interface: intro, filters, tags, sorting, columns, panel, compare, the NYSE pill.
- The language follows the browser on first visit (Czech browsers get Czech) and the choice is remembered.
- **Czech formatting:** decimal comma and a space before % (`0,03 %`, `+8,4 %`), sizes as `189 mld. USD`, ages as `14,0 let`, dates as `3. 10. 2026`.
- Everything visible is in Czech: fund descriptions (hand-written), company descriptions (hand-written), country names (via the browser), sectors, maturities and credit ratings. Czech sizes use USD (`189 mld. USD`). Translations are written for Czech readers, never word for word.

---

## 11. Running, updating and deploying

### 11.1 Run locally

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload     # → http://127.0.0.1:8000
```

### 11.2 Update the data

```sh
.venv/bin/python -m importer.ishares_us            # funds, returns, exposures (~10 min with --refresh)
.venv/bin/python -m importer.holdings              # holdings for every fund (~5 min)
.venv/bin/python -m importer.companies             # company descriptions (resumable; --skip-names for ticker-only)
```

### 11.3 Build and deploy

```sh
.venv/bin/python build_site.py                     # → dist/ (static site)
```

`dist/` contains `index.html`, `static/` (scripts, styles, data) and a `vercel.json` that sets cache headers and asks search engines not to index the site.

**Deployment plan:** static hosting on Vercel (free Hobby plan) or Cloudflare Pages. While data licensing is unresolved, the site should stay **private** — for example a Vercel firewall rule that allows only your IP address, or Cloudflare Access (free login for up to 50 people). A scheduled GitHub Action could refresh the data weekly and redeploy.

**Repository:** `github.com/jordyner/factsheeter`.
- `main` — the first version (clock + skyline design).
- `intro-redesign` — the current version described here.

The working rule is to **ask before every push or deploy**.

---

## 12. Quality checks

`research/screens/check.py` drives a headless browser against the running app and verifies, among others:

- all 482 funds load; the intro shows the headline, the live fund count and date, and the NYSE pill;
- the intro is typography only (no mascot), fills most of the first screen, and the screener is visible below it;
- **Explore ETFs** scrolls to the screener; a shared filtered link opens directly at the results;
- off-white is the default and the theme switch is remembered;
- **combined filters** give exactly the expected number of funds (cross-checked against the raw data);
- OR inside a filter, AND across filters; removing one tag keeps the others; Clear all restores everything;
- **include / exclude**: a chip cycles include → exclude → off; excluding Bonds leaves exactly 482 − 154 funds; excluding Emerging markets from a column filter removes exactly 57; *Europe ≤ 10 %* matches the data; exclusions survive a shared link;
- **numeric sorting** (not text), missing values always last, tie-breakers, the Add sort control;
- column show/hide, sticky header and ETF column, "—" for missing data;
- table-header filters create tags and highlight their columns;
- the side panel shows the top 10 holdings;
- Czech translation, decimal commas, remembered language;
- cards view, empty state, dark mode, phone layout without sideways scroll, reduced motion, no console errors.

It also saves screenshots of each state to `research/screens/`.

---

## 13. Legal, licensing and disclaimers

- **Not investment advice.** The site shows a data snapshot; figures may have changed. Every fund links to its source so users can verify. Past performance does not predict future returns.
- **iShares / BlackRock data** is subject to BlackRock's terms of use, which generally restrict republishing, especially commercially. Personal local use is fine; **before any public or commercial launch, check BlackRock's terms or use a licensed data provider.**
- **Wikipedia** text is CC BY-SA and **Wikidata** is CC0; each company description links to its article and the panel credits the source.
- **Fonts:** Google Fonts (open licences).
- **Unused images:** the Manhattan skyline photos (King of Hearts, Wikimedia Commons, CC BY-SA) are no longer shown; if they return, the credit must return with them.
- **Hosting:** Vercel's free Hobby plan is for non-commercial use only; monetization would need a paid plan or another host.

---

## 14. Known limitations

- **US-listed funds only.** European (UCITS) iShares ETFs — which most EU retail investors can actually buy — are not included yet.
- **Snapshot, not live.** Data is as of the last import; there is no automatic refresh yet.
- **Company descriptions cover ~69 %** of top-10 companies; some large names (e.g. AMD, PZU, Allegro) need the slower name-search pass.
- **Holdings are stored for the top 50 positions per fund**, so any analysis across full portfolios (e.g. overlap between funds) would be partial.
- **NYSE pill** ignores exchange holidays.
- **Holdings date vs factsheet:** holdings are daily from iShares, while the PDF factsheet is quarterly, so weights differ from the PDF (checked for EDEN: the app matches iShares' live file exactly).
- **Geography chips** use iShares' main-region label, which can differ from the actual weights (e.g. a "Global" fund that is 65 % US).
- **No accounts, alerts or portfolios** — it is a research tool, not a brokerage.

---

## 15. Roadmap and ideas

**Data**
- Add the **European UCITS iShares range** (≈460 funds, many share classes), grouping Acc/Dist/hedged versions under one fund, with a "listed in US / Europe" filter.
- Finish the **company-description name search** to raise coverage above 69 %.
- **Scheduled refresh** (weekly GitHub Action) and a visible "last updated" note.
- **Vanguard** next (≈90 US ETFs + UCITS; holdings feed works but is monthly with ~1 month lag, so per-fund dates must be shown); Xtrackers/Amundi later.
- **"What to watch"** — factual, sourced and dated risk notes for the ~30 most important companies.

**Product**
- Option to start at the screener for returning visitors.
- Plain-language column tooltips for new users.
- Saved searches / watchlists, with alerts when fees or holdings change.
- Overlap check between two funds (needs full holdings).
- Charts of historical performance.

**Launch**
- Private deployment on Vercel or Cloudflare Pages with IP or login protection.
- Licensing review before any public or monetized version; validate demand with real users first.

---

## 16. Glossary

| Term | Meaning | Czech |
|---|---|---|
| ETF | Exchange-traded fund: a fund that trades on a stock exchange like a share | ETF, burzovně obchodovaný fond |
| Annualized return | Average yearly return over a period | Průměrný roční výnos (p. a.) |
| Cumulative return | Total return over the whole period | Celkový (kumulativní) výnos |
| Expense ratio (TER) | Yearly cost of the fund as % of your investment | Nákladovost |
| NAV | Net asset value: value of the fund's holdings per share | Čistá hodnota aktiv |
| Market price | Price the ETF traded at on the exchange | Tržní cena |
| Holdings | The securities a fund owns | Pozice / držené cenné papíry |
| Exposure | Share of the fund in a region, country or sector | Expozice |
| Include / exclude filter | Keep only funds matching an option / remove funds matching it | Zahrnout / vyloučit |
| UCITS | EU fund standard; European-domiciled ETFs that EU retail investors can buy | UCITS |
| Accumulating / Distributing | Reinvests dividends / pays them out | Akumulační / distribuční |
| Yield (12m) | Dividends paid over the last 12 months as % of price | Dividendový výnos |
