"""Dev helper: screenshot the running app (http://127.0.0.1:8000) in a few states."""
import sys
from playwright.sync_api import sync_playwright

OUT = "research/screens"
with sync_playwright() as p:
    b = p.chromium.launch()
    errors = []
    for scheme in ("light", "dark"):
        pg = b.new_page(viewport={"width": 1400, "height": 1000}, color_scheme=scheme)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
        pg.goto("http://127.0.0.1:8000/")
        pg.wait_for_selector(".card")
        pg.wait_for_timeout(1200)
        pg.screenshot(path=f"{OUT}/home-{scheme}.png")
        if scheme == "light":
            pg.click(".card[data-t='CORO']") if pg.query_selector(".card[data-t='CORO']") else pg.click(".card")
            pg.wait_for_timeout(300)
            pg.screenshot(path=f"{OUT}/drawer.png")
            pg.keyboard.press("Escape")
            pg.goto("http://127.0.0.1:8000/#c=IVV,EFA,AGG&w=eu&age=10")
            pg.wait_for_timeout(800)
            pg.screenshot(path=f"{OUT}/filtered.png")
            pg.click("#compareOpen"); pg.wait_for_timeout(300)
            pg.screenshot(path=f"{OUT}/compare.png")
            mp = b.new_page(viewport={"width": 390, "height": 844})
            mp.goto("http://127.0.0.1:8000/"); mp.wait_for_selector(".card"); mp.wait_for_timeout(800)
            mp.screenshot(path=f"{OUT}/mobile.png", full_page=False)
            print("mobile scrollWidth", mp.evaluate("document.documentElement.scrollWidth"))
    print("errors:", errors)
    b.close()
