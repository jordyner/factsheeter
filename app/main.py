"""Factsheeter web app: serves the imported ETF snapshot and the screener UI.

Run:  .venv/bin/uvicorn app.main:app --reload   ->  http://127.0.0.1:8000
"""

import sqlite3
from collections import defaultdict
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "factsheeter.db"
WEB = ROOT / "web"

app = FastAPI(title="Factsheeter")


def connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise HTTPException(503, "No data yet. Run: .venv/bin/python -m importer.ishares_us")
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


@app.get("/api/funds")
def funds():
    """All funds with their exposure breakdowns. Small enough (~500 rows) to filter client-side."""
    con = connect()
    exposures: dict[int, dict] = defaultdict(lambda: defaultdict(list))
    as_of: dict[int, dict] = defaultdict(dict)
    assumed: dict[int, list] = defaultdict(list)
    for e in con.execute("SELECT * FROM exposures ORDER BY fund_id, dimension, weight DESC"):
        exposures[e["fund_id"]][e["dimension"]].append([e["label"], e["weight"]])
        as_of[e["fund_id"]][e["dimension"]] = e["as_of"]
        # region is always derived; a derived country row means "assumed from classification"
        if e["derived"] and e["dimension"] == "country":
            assumed[e["fund_id"]].append("country")

    out = []
    for f in con.execute("SELECT * FROM funds"):
        d = {k: f[k] for k in f.keys() if k != "raw_screener"}
        # Some product pages publish a breakdown whose weights are all zero; that is missing data, not 0%.
        d["exposures"] = {dim: rows for dim, rows in exposures.get(f["id"], {}).items() if any(w for _, w in rows)}
        d["exposures_as_of"] = as_of.get(f["id"], {})
        d["country_assumed"] = "country" in assumed.get(f["id"], [])
        out.append(d)
    con.close()
    return out


@app.get("/api/meta")
def meta():
    con = connect()
    m = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM snapshot")}
    m["failures"] = [dict(r) for r in con.execute("SELECT * FROM failures")]
    con.close()
    return m


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


app.mount("/static", StaticFiles(directory=WEB), name="static")
