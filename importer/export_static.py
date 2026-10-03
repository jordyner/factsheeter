"""Write the API responses as static JSON (web/data/*.json) so the site can be hosted without a server.

The browser loads these files directly; the FastAPI app serves the same folder locally.
Runs automatically at the end of an import. Manual run:  .venv/bin/python -m importer.export_static
"""

import json

from app.main import ROOT, funds, meta

OUT = ROOT / "web" / "data"


def export() -> None:
    OUT.mkdir(exist_ok=True)
    for name, data in (("funds.json", funds()), ("meta.json", meta())):
        (OUT / name).write_text(json.dumps(data, separators=(",", ":")))
    print(f"  static data -> {OUT}")


if __name__ == "__main__":
    export()
