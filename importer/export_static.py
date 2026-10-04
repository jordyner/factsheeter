"""Write the API responses as static JSON (web/data/*.json) so the site can be hosted without a server.

The browser loads these files directly; the FastAPI app serves the same folder locally.
Runs automatically at the end of an import. Manual run:  .venv/bin/python -m importer.export_static
"""

import json
import re

from app.main import ROOT, funds, meta

OUT = ROOT / "web" / "data"


HOLDINGS = OUT / "holdings"
TRANSLATIONS = ROOT / "translations" / "funds_cs.json"   # Czech fund descriptions, written for readers (not word for word)


def clean_text(s: str | None) -> str | None:
    """iShares descriptions sometimes carry HTML and a patent notice; keep the plain sentences."""
    if not s:
        return s
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"This Fund is covered by U\.S\. Patent Nos?\.[^.]*(\.[^.]*)?\.", "", s)
    return re.sub(r"\s+", " ", s).strip()


def concentration(ticker: str) -> dict | None:
    """How much of a fund depends on a few positions, from its holdings file (if any)."""
    path = HOLDINGS / f"{ticker}.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    rows = data.get("holdings") or []
    if not rows:
        return None
    top = rows[0]
    about = top.get("about") or {}
    return {
        "as_of": data.get("as_of"),
        "count": data.get("count"),
        "top1": {"name": about.get("label") or top["name"], "ticker": top.get("ticker"), "weight": top["weight"]},
        "top5": round(sum(h["weight"] for h in rows[:5]), 2),
        "top10": round(sum(h["weight"] for h in rows[:10]), 2),
        # share of the top 10 that are company shares (vs bonds, cash, futures): decides the wording
        "equity_top10": sum(1 for h in rows[:10] if h.get("asset_class") == "Equity"),
    }


def export() -> None:
    OUT.mkdir(exist_ok=True)
    fund_rows = funds()
    cs = json.loads(TRANSLATIONS.read_text()) if TRANSLATIONS.exists() else {}
    for f in fund_rows:
        f["conc"] = concentration(f["ticker"])
        f["description"] = clean_text(f.get("description"))
        f["description_cs"] = cs.get(f["ticker"])
    for name, data in (("funds.json", fund_rows), ("meta.json", meta())):
        (OUT / name).write_text(json.dumps(data, separators=(",", ":")))
    print(f"  static data -> {OUT}")


if __name__ == "__main__":
    export()
