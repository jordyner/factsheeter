"""Dev helper: render font candidates side by side."""
from playwright.sync_api import sync_playwright
FONTS = ["Orbitron", "Michroma", "Audiowide", "Oxanium", "Chakra Petch", "Tomorrow", "Saira", "Zen Dots", "Exo 2", "Space Grotesk"]
fam = "&".join("family=" + f.replace(" ", "+") + (":wght@400;700;900" if f in ("Orbitron","Exo 2") else ":wght@400;700" if f in ("Oxanium","Chakra Petch","Tomorrow","Saira","Space Grotesk") else "") for f in FONTS)
rows = "".join(f'''<div class="r"><div class="n">{f}</div><div style="font-family:'{f}'"><span class="big">08:59 482</span>
<span class="mid">Factsheeter · New York 11:59</span><span class="tbl">IVV +8.42% 26.4 2000-05-15 0.03%</span></div></div>''' for f in FONTS)
html = f'''<html><head><link href="https://fonts.googleapis.com/css2?{fam}&display=swap" rel="stylesheet"><style>
body{{margin:0;background:#e9e8e3;font-family:sans-serif;padding:16px}} .r{{display:grid;grid-template-columns:120px 1fr;align-items:center;border-bottom:1px solid #0002;padding:6px 0}}
.n{{font-size:12px;color:#666}} .big{{font-size:46px;font-weight:900;margin-right:18px}} .mid{{font-size:18px;margin-right:18px}} .tbl{{font-size:14px;color:#333}}</style></head><body>{rows}</body></html>'''
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1300, "height": 820})
    pg.set_content(html); pg.wait_for_timeout(2500)
    pg.screenshot(path="research/screens/fonts.png", full_page=True); b.close()
