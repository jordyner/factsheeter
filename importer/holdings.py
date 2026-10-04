"""Fund holdings from each product page's "latest-holdings.csv" (the file behind iShares' Holdings tab).

Writes web/data/holdings/<TICKER>.json per fund: the largest positions with weight, sector, country and
exchange, plus the fund-level as-of date and total position count. The browser loads a fund's file only
when its detail panel opens, so the main data file stays small.

Raw CSVs are cached in data/cache/holdings/ (pass --refresh to refetch).
Usage:  .venv/bin/python -m importer.holdings [--limit N] [--refresh]
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import io
import json
import random
import sqlite3
import sys
from datetime import datetime

import httpx

from importer.ishares_us import CONCURRENCY, DATA, DB_PATH, DELAY_RANGE, HEADERS, ROOT, get

CACHE = DATA / "cache" / "holdings"
OUT = ROOT / "web" / "data" / "holdings"
KEEP = 50  # positions kept per fund (sorted by weight)
WEIGHT_COLS = ("Weight (%)", "Market Weight")  # the column name differs between fund families


def num(s: str) -> float | None:
    s = (s or "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def parse_csv(text: str) -> dict:
    """iShares holdings CSV: a few 'key,value' header lines, a blank line, then the holdings table."""
    lines = text.lstrip("﻿").splitlines()
    meta, start = {}, None
    for i, line in enumerate(lines):
        row = next(csv.reader([line]), [])
        if "Name" in row and any(c in row for c in WEIGHT_COLS):   # equity files start with Ticker, bond files with Name
            start = i
            break
        if len(row) >= 2:
            meta[row[0].strip()] = row[1].strip()
    if start is None:
        return {"as_of": None, "count": 0, "holdings": []}

    rows = []
    for r in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        w = num(next((r[c] for c in WEIGHT_COLS if r.get(c) not in (None, "")), ""))
        name = (r.get("Name") or "").strip()
        if w is None or not name or name.startswith("\xa0"):
            continue  # footer/disclaimer lines
        rows.append({
            "ticker": (r.get("Ticker") or r.get("Issuer Ticker") or "").strip(),
            "name": name,
            "sector": (r.get("Sector") or "").strip() or None,
            "asset_class": (r.get("Asset Class") or "").strip() or None,
            "weight": w,
            "country": (r.get("Location") or "").strip() or None,
            "exchange": (r.get("Exchange") or "").strip() or None,
        })
        for key, col in (("maturity", "Maturity"), ("coupon", "Coupon (%)")):   # bonds only
            v = (r.get(col) or "").strip()
            if v and v != "-":
                rows[-1][key] = v
    rows.sort(key=lambda h: -h["weight"])
    as_of = meta.get("Fund Holdings as of")
    try:
        as_of = datetime.strptime(as_of, "%b %d, %Y").date().isoformat() if as_of else None
    except ValueError:
        pass
    return {"as_of": as_of, "count": len(rows), "holdings": rows[:KEEP]}


async def fetch_all(funds: list[tuple], refresh: bool) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(CONCURRENCY)
    out, failures, done = {}, {}, 0

    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=90) as client:
        async def one(pid, ticker, url):
            nonlocal done
            cache = CACHE / f"{pid}.csv"
            if cache.exists() and not refresh:
                text = cache.read_text()
            else:
                async with sem:
                    try:
                        text = (await get(client, url.rstrip("/") + "/latest-holdings.csv")).text
                        cache.write_text(text)
                    except Exception as e:  # noqa: BLE001 - e.g. trusts without a holdings file
                        failures[ticker] = str(e)[:120]
                        text = None
                    await asyncio.sleep(random.uniform(*DELAY_RANGE))
            if text:
                out[ticker] = parse_csv(text)
            done += 1
            if done % 50 == 0 or done == len(funds):
                print(f"  holdings {done}/{len(funds)} (failures: {len(failures)})", flush=True)

        await asyncio.gather(*(one(*f) for f in funds))
    return out, failures


def write(holdings: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        if old.stem not in holdings:
            old.unlink()
    for ticker, h in holdings.items():
        (OUT / f"{ticker}.json").write_text(json.dumps(h, separators=(",", ":")))


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    con = sqlite3.connect(DB_PATH)
    funds = con.execute("SELECT id, ticker, product_url FROM funds ORDER BY ticker").fetchall()
    con.close()
    if args.limit:
        funds = funds[: args.limit]
    print(f"Fetching holdings for {len(funds)} funds ...")
    holdings, failures = await fetch_all(funds, args.refresh)
    write(holdings)
    empty = [t for t, h in holdings.items() if not h["holdings"]]
    print(f"Done -> {OUT}: {len(holdings)} funds, {len(empty)} without positions, {len(failures)} failures")
    from importer.export_static import export   # refresh per-fund concentration in funds.json
    export()
    for t, msg in list(failures.items())[:10]:
        print("   ", t, msg)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
