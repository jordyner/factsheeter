"""One-off snapshot importer for US-listed iShares ETFs.

Sources:
  1. The iShares product-screener JSON (one request, all funds): identifiers,
     fees, inception date, NAV/price returns, fund size, primary region.
  2. Each fund's product page: exposure breakdowns (sector, countries,
     maturity, rating, ...) embedded as JSON, the short plain-English fund
     description (schema.org JSON-LD), and the factsheet PDF link.

Only extracted data is cached (data/cache/pages/<id>.json), not full HTML.
Re-running reuses the cache; pass --refresh to refetch pages.

Usage:  .venv/bin/python -m importer.ishares_us [--limit N] [--refresh]
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import random
import re
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx

from importer.regions import region_for

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "cache" / "pages"
DB_PATH = DATA / "factsheeter.db"

BASE = "https://www.ishares.com"
ALLOWED_HOSTS = {"www.ishares.com"}
SCREENER_URL = (
    BASE + "/us/product-screener/product-screener-v3.1.jsn"
    "?dcrPath=/templatedata/config/product-screener-v3/data/en/us-ishares/"
    "ishares-product-screener-backend-config&siteEntryPassthrough=true"
)
HEADERS = {"User-Agent": "Mozilla/5.0 (factsheeter personal research; low-rate)"}

ASSUME_COUNTRY_CLASSES = {"Equity", "Fixed Income", "Real Estate"}

CONCURRENCY = 3
DELAY_RANGE = (0.4, 1.0)  # polite pause between requests per worker
RETRIES = 3

EXPOSURE_RE = re.compile(
    r'componentprops="(\{&quot;componentId&quot;:&quot;exposureBreakdowns&quot;.*?\})" componentkey'
)
LDJSON_RE = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.S)
META_DESC_RE = re.compile(r'<meta name="description" content="([^"]*)"')
FACTSHEET_RE = re.compile(r'(?:https://www\.ishares\.com)?(/us/literature/fact-sheet/[^"?\s]+\.pdf)')


# ---------------------------------------------------------------- helpers

def raw(v):
    """Screener values are either "-" or {"d": display, "r": raw}. Return raw or None."""
    if isinstance(v, dict):
        return v.get("r")
    return None


def yyyymmdd(v) -> str | None:
    r = raw(v)
    if not r:
        return None
    s = str(int(r))
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def check_host(url: str) -> None:
    host = urlparse(str(url)).hostname
    if host not in ALLOWED_HOSTS:
        raise ValueError(f"refusing non-iShares host: {host}")


async def get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    check_host(url)
    last = None
    for attempt in range(RETRIES):
        try:
            r = await client.get(url)
            check_host(r.url)  # redirects must stay on iShares
            if r.status_code == 200:
                return r
            last = f"HTTP {r.status_code}"
            if r.status_code in (403, 404):
                break
        except httpx.HTTPError as e:
            last = repr(e)
        await asyncio.sleep(2 ** attempt * 2)
    raise RuntimeError(f"{url}: {last}")


# ---------------------------------------------------------------- page parsing

def parse_description(page_html: str) -> str | None:
    """The 1-2 sentence "what this fund does" blurb shown at the top of the product page."""
    for block in LDJSON_RE.findall(page_html):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        for node in data.get("@graph", [data]) if isinstance(data, dict) else []:
            if node.get("name") == "FundDescriptionV3" and node.get("description"):
                return html.unescape(node["description"]).strip()
    m = META_DESC_RE.search(page_html)
    return html.unescape(m.group(1)).strip() if m and m.group(1).strip() else None


def parse_page(page_html: str, ticker: str) -> dict:
    """Extract exposure tables and factsheet link from a product page."""
    exposures = []
    m = EXPOSURE_RE.search(page_html)
    if m:
        props = json.loads(html.unescape(m.group(1)))

        def add(dimension: str, dp: dict):
            if not dp or "type" not in dp or "fund" not in dp:
                return
            labels, weights = dp["type"].get("value") or [], dp["fund"].get("value") or []
            as_of = dp.get("asOf", {}).get("value")
            as_of = f"{str(as_of)[:4]}-{str(as_of)[4:6]}-{str(as_of)[6:8]}" if as_of else None
            for label, w in zip(labels, weights):
                if w is None:
                    continue
                exposures.append({"dimension": dimension, "label": label, "weight": float(w), "as_of": as_of})

        for name, c in props.get("containersByNameMap", {}).items():
            add(name, c.get("dataPointsByNameMap"))
            for sub, sc in (c.get("subContainersByNameMap") or {}).items():
                # e.g. geography/countries -> "country"
                add("country" if sub == "countries" else f"{name}/{sub}", sc.get("dataPointsByNameMap"))

    links = sorted(set(FACTSHEET_RE.findall(page_html)))
    own = [l for l in links if l.split("/")[-1].startswith(ticker.lower() + "-")]
    factsheet = BASE + (own or links or [None])[0] if (own or links) else None
    return {"exposures": exposures, "factsheet_url": factsheet, "has_exposure_component": bool(m),
            "description": parse_description(page_html)}


# ---------------------------------------------------------------- fetching

async def fetch_pages(funds: list[dict], refresh: bool) -> tuple[dict, dict]:
    CACHE.mkdir(parents=True, exist_ok=True)
    results, failures = {}, {}
    sem = asyncio.Semaphore(CONCURRENCY)
    done = 0

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=60) as client:

        async def one(f):
            nonlocal done
            pid, ticker = f["portfolioId"], f["localExchangeTicker"]
            cache_file = CACHE / f"{pid}.json"
            cached = json.loads(cache_file.read_text()) if cache_file.exists() and not refresh else None
            if cached and "description" in cached:  # older caches predate descriptions: refetch
                results[pid] = cached
            else:
                async with sem:
                    try:
                        r = await get(client, BASE + f["productPageUrl"])
                        parsed = parse_page(r.text, ticker)
                        parsed["fetched_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                        cache_file.write_text(json.dumps(parsed))
                        results[pid] = parsed
                    except Exception as e:  # noqa: BLE001 - record and continue
                        failures[pid] = f"{ticker}: {e}"
                    await asyncio.sleep(random.uniform(*DELAY_RANGE))
            done += 1
            if done % 25 == 0 or done == len(funds):
                print(f"  pages {done}/{len(funds)} (failures: {len(failures)})", flush=True)

        await asyncio.gather(*(one(f) for f in funds))
    return results, failures


# ---------------------------------------------------------------- database

SCHEMA = """
DROP TABLE IF EXISTS funds;
DROP TABLE IF EXISTS exposures;
DROP TABLE IF EXISTS failures;
CREATE TABLE IF NOT EXISTS snapshot (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE funds (
  id INTEGER PRIMARY KEY,          -- iShares portfolioId
  ticker TEXT, name TEXT, isin TEXT, cusip TEXT,
  asset_class TEXT, sub_asset_class TEXT, market_type TEXT,
  primary_region TEXT, primary_country TEXT, investment_style TEXT,
  inception_date TEXT,
  expense_ratio REAL,              -- net expense ratio, % ("fees" in screener)
  gross_expense_ratio REAL,
  net_assets REAL, net_assets_as_of TEXT,
  nav_1y REAL, nav_3y REAL, nav_5y REAL, nav_10y REAL, nav_si REAL, nav_returns_as_of TEXT,
  price_1y REAL, price_3y REAL, price_5y REAL, price_10y REAL, price_si REAL, price_returns_as_of TEXT,
  ttm_yield REAL, ttm_yield_as_of TEXT,
  product_url TEXT, factsheet_url TEXT, page_fetched_at TEXT,
  description TEXT,                -- short "what the fund does" text from the product page
  raw_screener TEXT
);
CREATE TABLE exposures (
  fund_id INTEGER, dimension TEXT, label TEXT, weight REAL, as_of TEXT, derived INTEGER DEFAULT 0
);
CREATE INDEX exposures_fund ON exposures(fund_id);
CREATE TABLE failures (fund_id INTEGER, message TEXT);
"""


def build_db(funds: list[dict], pages: dict, failures: dict, screener_fetched: str) -> dict:
    DATA.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)
    unknown_countries: dict[str, int] = {}

    for f in funds:
        pid = f["portfolioId"]
        page = pages.get(pid, {})
        row = (
                pid, f.get("localExchangeTicker"), f.get("fundName"), f.get("isin"), f.get("cusip"),
                f.get("aladdinAssetClass"), f.get("aladdinSubAssetClass"), f.get("aladdinMarketType"),
                f.get("aladdinRegion"), f.get("aladdinCountry"),
                (f.get("investmentStyle") or "").strip("[]") or None,
                yyyymmdd(f.get("inceptionDate")),
                raw(f.get("fees")), raw(f.get("ter")),
                raw(f.get("totalNetAssetsFund")), yyyymmdd(f.get("totalNetAssetsFundAsOf")),
                raw(f.get("navOneYearAnnualized")), raw(f.get("navThreeYearAnnualized")),
                raw(f.get("navFiveYearAnnualized")), raw(f.get("navTenYearAnnualized")),
                raw(f.get("navSinceInceptionAnnualized")), yyyymmdd(f.get("navAnnualisedAsOf")),
                raw(f.get("priceOneYearAnnualized")), raw(f.get("priceThreeYearAnnualized")),
                raw(f.get("priceFiveYearAnnualized")), raw(f.get("priceTenYearAnnualized")),
                raw(f.get("priceSinceInceptionAnnualized")), yyyymmdd(f.get("priceYearAsOf")),
                raw(f.get("twelveMonTrlYield")), yyyymmdd(f.get("twelveMonTrlYieldAsOf")),
                BASE + f["productPageUrl"], page.get("factsheet_url"), page.get("fetched_at"),
                page.get("description"),
                json.dumps(f),
        )
        con.execute("INSERT INTO funds VALUES (" + ",".join("?" * len(row)) + ")", row)

        exps = page.get("exposures", [])
        for e in exps:
            con.execute("INSERT INTO exposures VALUES (?,?,?,?,?,0)",
                        (pid, e["dimension"], e["label"], e["weight"], e["as_of"]))

        # Single-country funds publish no country table. Assume 100% in the fund's
        # classified country, for asset classes where that classification means
        # "where the holdings are" (not commodities/crypto/cash).
        country = f.get("aladdinCountry")
        if (not any(e["dimension"] == "country" for e in exps)
                and f.get("aladdinAssetClass") in ASSUME_COUNTRY_CLASSES
                and country and country not in ("Broad", "Global")):
            assumed = {"dimension": "country", "label": country, "weight": 100.0, "as_of": None}
            con.execute("INSERT INTO exposures VALUES (?,?,?,?,?,1)", (pid, "country", country, 100.0, None))
            exps = exps + [assumed]

        # Derive region weights from country weights.
        regions: dict[str, float] = {}
        as_of = None
        for e in exps:
            if e["dimension"] != "country":
                continue
            as_of = e["as_of"]
            reg = region_for(e["label"])
            if reg is None:
                unknown_countries[e["label"]] = unknown_countries.get(e["label"], 0) + 1
                reg = "Other"
            regions[reg] = regions.get(reg, 0) + e["weight"]
        for reg, w in regions.items():
            con.execute("INSERT INTO exposures VALUES (?,?,?,?,?,1)", (pid, "region", reg, round(w, 2), as_of))

    for pid, msg in failures.items():
        con.execute("INSERT INTO failures VALUES (?,?)", (pid, msg))

    meta = {
        "source": "iShares US product screener + product pages (www.ishares.com)",
        "screener_fetched_at": screener_fetched,
        "imported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fund_count": str(len(funds)),
        "page_failures": str(len(failures)),
    }
    for k, v in meta.items():
        con.execute("INSERT OR REPLACE INTO snapshot VALUES (?,?)", (k, v))
    con.commit()
    con.close()
    return unknown_countries


# ---------------------------------------------------------------- main

async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="only import the first N funds (for testing)")
    ap.add_argument("--refresh", action="store_true", help="refetch screener and pages, ignoring cache")
    args = ap.parse_args()

    DATA.mkdir(exist_ok=True)
    screener_file = DATA / "cache" / "screener.json"
    screener_file.parent.mkdir(parents=True, exist_ok=True)
    if screener_file.exists() and not args.refresh:
        print("Using cached screener", screener_file)
    else:
        print("Fetching screener ...")
        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=120) as c:
            r = await get(c, SCREENER_URL)
        screener_file.write_text(r.text)
    screener_fetched = datetime.fromtimestamp(screener_file.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")

    data = json.loads(screener_file.read_text())
    funds = [
        f for f in data.values()
        if "etf" in (f.get("productView") or []) and f.get("localExchangeTicker") and f.get("productPageUrl")
    ]
    funds.sort(key=lambda f: f["localExchangeTicker"])
    if args.limit:
        funds = funds[: args.limit]
    print(f"{len(funds)} ETFs in screener")

    pages, failures = await fetch_pages(funds, args.refresh)
    unknown = build_db(funds, pages, failures, screener_fetched)
    from importer.export_static import export  # after the DB exists; imports the API code
    export()

    no_exp = [f["localExchangeTicker"] for f in funds if not pages.get(f["portfolioId"], {}).get("exposures")]
    print(f"\nDone -> {DB_PATH}")
    print(f"  page failures: {len(failures)}")
    for msg in list(failures.values())[:10]:
        print("   ", msg)
    print(f"  funds without exposure data: {len(no_exp)} {no_exp[:15]}")
    no_desc = [f["localExchangeTicker"] for f in funds if not pages.get(f["portfolioId"], {}).get("description")]
    print(f"  funds without description: {len(no_desc)} {no_desc[:15]}")
    if unknown:
        print(f"  countries not mapped to a region (counted as 'Other'): {dict(sorted(unknown.items(), key=lambda x: -x[1]))}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
