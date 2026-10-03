"""Build the deployable static site into dist/ (no server needed).

    .venv/bin/python build_site.py        # then deploy dist/ (e.g. Vercel)

dist/index.html is the page, dist/static/ mirrors web/ (scripts, styles, images, data),
so the same /static/... paths work locally (FastAPI) and on a static host.
"""

import json
import shutil
from pathlib import Path

from importer.export_static import export

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
DIST = ROOT / "dist"

# Vercel config shipped with the site: private research tool, so ask search engines not to index it;
# images are immutable, data changes on each import.
VERCEL = {
    "headers": [
        {"source": "/(.*)", "headers": [{"key": "X-Robots-Tag", "value": "noindex, nofollow"}]},
        {"source": "/static/img/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=604800"}]},
        {"source": "/static/data/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=0, must-revalidate"}]},
    ]
}


def build() -> None:
    export()
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(WEB, DIST / "static", ignore=shutil.ignore_patterns(".DS_Store"))
    shutil.copy2(WEB / "index.html", DIST / "index.html")
    (DIST / "vercel.json").write_text(json.dumps(VERCEL, indent=2))
    size = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file())
    print(f"Built {DIST} ({size / 1e6:.1f} MB)")


if __name__ == "__main__":
    build()
