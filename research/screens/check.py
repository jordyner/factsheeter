"""Dev helper: functional checks + screenshots of the running app (http://127.0.0.1:8000)."""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8000/"
OUT = "research/screens"
fails = []

def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)

def col_values(pg, col_index):
    return pg.eval_on_selector_all(f"#tbody tr td:nth-child({col_index})", "els => els.map(e => e.innerText.trim())")

def header_index(pg, label):
    heads = pg.eval_on_selector_all("#thead th", "els => els.map(e => e.innerText.trim())")
    return next(i for i, h in enumerate(heads, 1) if h.upper().startswith(label.upper()))

def pct(s):
    return None if s in ("—", "") else float(s.replace("−", "-").replace("+", "").replace("%", ""))

with sync_playwright() as p:
    b = p.chromium.launch()
    errors = []
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.add_init_script("if (!sessionStorage.getItem('wiped')) { localStorage.clear(); sessionStorage.setItem('wiped', 1); }")
    pg.goto(URL); pg.wait_for_selector("#tbody tr")
    total = int(pg.inner_text("#countNum"))
    check(total == 482, f"loads all funds ({total})")
    clock = pg.inner_text(".hero-nums")
    check(":" in clock and "--" not in clock, f"market clock running ({clock.split()[0]})")
    check(len(pg.query_selector_all(".city")) == 6, "your time + 5 exchanges listed")
    check(pg.inner_text("#spotTitle") != "", f"spotlight shows first fund: {pg.inner_text('#spotTitle')}")
    pg.wait_for_timeout(700)
    pg.screenshot(path=f"{OUT}/v13-home.png")
    pg.screenshot(path=f"{OUT}/v13-home-full.png", full_page=True)

    # --- combined filters: age >= 10 AND SI >= 7 AND fee <= 0.30
    pg.click("#toggleFilters")
    pg.fill("#minAge", "10"); pg.fill("#minSI", "7"); pg.fill("#maxFee", "0.3")
    pg.wait_for_timeout(200)
    n3 = int(pg.inner_text("#countNum"))
    data = pg.evaluate("""async () => (await (await fetch('/api/funds')).json())""")
    from datetime import date
    def age(f):
        if not f["inception_date"]: return None
        y, m, d = map(int, f["inception_date"].split("-"))
        return (date.today() - date(y, m, d)).days / 365.25
    expect = [f for f in data if age(f) is not None and age(f) >= 10 and f["nav_si"] is not None and f["nav_si"] >= 7
              and f["expense_ratio"] is not None and f["expense_ratio"] <= 0.3]
    check(n3 == len(expect), f"3 combined filters: app {n3} == expected {len(expect)}")
    chips = pg.eval_on_selector_all("#activeBar .achip", "els => els.map(e => e.innerText)")
    check(len(chips) == 3, f"3 active chips: {chips}")
    pg.screenshot(path=f"{OUT}/v13-filters.png")

    # --- OR within category, AND across
    pg.click("#fTypes [data-type='Equity']"); pg.click("#fTypes [data-type='Fixed Income']")
    pg.wait_for_timeout(150)
    n_or = int(pg.inner_text("#countNum"))
    exp_or = [f for f in expect if f["asset_class"] in ("Equity", "Fixed Income")]
    check(n_or == len(exp_or), f"asset class OR: app {n_or} == expected {len(exp_or)}")

    # --- clearing one filter keeps the others
    pg.click("#activeBar .achip:has-text('Expense ratio') button")
    pg.wait_for_timeout(150)
    chips = pg.eval_on_selector_all("#activeBar .achip", "els => els.map(e => e.innerText)")
    check(len(chips) == 3 and not any("Expense" in c for c in chips), f"removed fee chip, others kept: {chips}")
    check(pg.input_value("#maxFee") == "" and pg.input_value("#minAge") == "10" and pg.input_value("#minSI") == "7", "inputs in sync after removing one chip")
    exp2 = [f for f in data if age(f) is not None and age(f) >= 10 and f["nav_si"] is not None and f["nav_si"] >= 7 and f["asset_class"] in ("Equity", "Fixed Income")]
    check(int(pg.inner_text("#countNum")) == len(exp2), f"count after removing one filter = {len(exp2)}")

    # --- clear all
    pg.click("#clearAll"); pg.wait_for_timeout(150)
    check(int(pg.inner_text("#countNum")) == 482, "clear all restores 482")

    # --- numeric sort on Since launch (desc), missing last
    pg.click("#thead [data-sort='rsi']"); pg.wait_for_timeout(200)
    idx = header_index(pg, "Since launch")
    vals = [pct(v) for v in col_values(pg, idx)]
    nums = [v for v in vals if v is not None]
    first_missing = next((i for i, v in enumerate(vals) if v is None), len(vals))
    check(nums == sorted(nums, reverse=True), "since-launch sorted numerically desc (not as text)")
    check(all(v is None for v in vals[first_missing:]), f"missing values last ({len(vals) - len(nums)} missing)")
    pg.click("#thead [data-sort='rsi']"); pg.wait_for_timeout(200)
    vals = [pct(v) for v in col_values(pg, idx)]
    nums = [v for v in vals if v is not None]
    check(nums == sorted(nums) and vals[-1] is None, "ascending also keeps missing last")

    # --- secondary sort: Age desc breaks ties in fee asc
    pg.click("#thead [data-sort='fee']"); pg.wait_for_timeout(100)
    pg.click("#thead [data-sort='age']", modifiers=["Shift"]); pg.wait_for_timeout(200)
    sortbar = pg.inner_text("#sortBar")
    check("1." in sortbar and "2." in sortbar, "sort bar shows ordered rules")
    fi, ai = header_index(pg, "Expense"), header_index(pg, "Age")
    fees = [pct(v) for v in col_values(pg, fi)]
    ages = [float(v) if v not in ("—", "< 1 yr") else 0 for v in col_values(pg, ai)]
    ok = all(not (fees[i] == fees[i + 1] and ages[i] < ages[i + 1]) for i in range(len(fees) - 1) if fees[i] is not None and fees[i+1] is not None)
    check(ok, "ties in expense ratio broken by age (oldest first)")
    pg.select_option("#addSort", "size"); pg.wait_for_timeout(150)
    check("3." in pg.inner_text("#sortBar"), "Add sort control adds a 3rd rule")

    # --- columns menu
    pg.click("#colMenu summary"); pg.click("[data-col='r10']"); pg.wait_for_timeout(150)
    heads = pg.eval_on_selector_all("#thead th", "els => els.map(e => e.innerText.trim())")
    check(not any(h.startswith("10Y") for h in heads), "column hidden via Columns menu")
    pg.click("[data-col='size']"); pg.wait_for_timeout(150)
    pg.keyboard.press("Escape")
    heads = pg.eval_on_selector_all("#thead th", "els => els.map(e => e.innerText.trim())")
    check(any(h.startswith("SIZE") for h in heads), "optional column shown")

    # --- sticky header + first column
    pg.evaluate("document.querySelector('#tableView').scrollTo(400, 600)"); pg.wait_for_timeout(100)
    th_top = pg.evaluate("document.querySelector('#thead th').getBoundingClientRect().top - document.querySelector('#tableView').getBoundingClientRect().top")
    first_left = pg.evaluate("document.querySelector('#tbody tr td.sticky').getBoundingClientRect().left - document.querySelector('#tableView').getBoundingClientRect().left")
    check(abs(th_top) < 2 and abs(first_left) < 2, f"sticky header ({th_top:.0f}) and ETF column ({first_left:.0f})")
    pg.evaluate("document.querySelector('#tableView').scrollTo(0, 0)")

    # --- missing data shows dash
    pg.fill("#q", "IBIT"); pg.wait_for_timeout(150)
    cells = pg.eval_on_selector_all("#tbody tr[data-t='IBIT'] td", "els => els.map(e => e.innerText.trim())")
    check("—" in cells and not any(c in ("0.00%", "+0.00%") for c in cells), f"young fund shows — not zero: {cells}")
    pg.fill("#q", "")

    # --- compare + drawer via keyboard-ish path
    pg.click("#activeBar .linkbtn") if pg.query_selector("#clearAll") else None
    for t in ("IVV", "EFA"):
        pg.check(f"#tbody input[data-cmp='{t}']")
    pg.wait_for_timeout(100)
    check(pg.inner_text("#compareOpen").startswith("Compare 2"), "compare selection works")
    pg.click("#tbody tr[data-t='EFA'] .expobtn[data-expo='sector']"); pg.wait_for_timeout(500)
    check(pg.is_visible("#drawer") and pg.is_visible("#dim-sector"), "exposure cell opens drawer at breakdown")
    pg.wait_for_selector("#holdingsSec .hold", timeout=5000)
    nh = len(pg.query_selector_all("#holdingsSec .hold"))
    check(nh == 10, f"side panel lists top {nh} holdings with weights")
    pg.screenshot(path=f"{OUT}/v13-drawer.png")
    pg.keyboard.press("Escape")
    pg.click("#compareOpen"); pg.wait_for_timeout(200)
    pg.screenshot(path=f"{OUT}/v13-compare.png")
    pg.keyboard.press("Escape")

    # --- cards view + empty state
    pg.click("#viewSeg [data-v='cards']"); pg.wait_for_timeout(300)
    check(pg.is_visible(".card") and not pg.is_visible("#tableView"), "cards view toggles")
    pg.screenshot(path=f"{OUT}/v13-cards.png")
    pg.click("#viewSeg [data-v='table']")
    pg.fill("#minSI", "90"); pg.wait_for_timeout(150)
    check(pg.is_visible("#emptyState") and pg.is_visible("#emptyClear"), "empty state shown")
    pg.screenshot(path=f"{OUT}/v13-empty.png")
    pg.click("#emptyClear")

    # --- filters from the table header: funnel -> pop-up -> tag
    pg.click("#activeBar #clearAll") if pg.query_selector("#clearAll") else None
    pg.fill("#q", ""); pg.wait_for_timeout(100)
    pg.click("#thead [data-filter='age']"); pg.wait_for_timeout(100)
    check(pg.is_visible("#colPop"), "funnel opens column filter pop-up")
    pg.fill("#colPop [data-pk='minAge']", "10"); pg.wait_for_timeout(150)
    pg.keyboard.press("Enter")
    pg.click("#thead [data-filter='rsi']"); pg.fill("#colPop [data-pk='minSI']", "7"); pg.wait_for_timeout(150)
    pg.click("#thead [data-filter='fee']"); pg.fill("#colPop [data-pk='maxFee']", "0.3"); pg.wait_for_timeout(150)
    pg.click("#colMenu summary"); pg.click("[data-col='type']"); pg.keyboard.press("Escape")
    pg.click("#thead [data-filter='type']"); pg.check("#colPop [data-ptype='Equity']"); pg.wait_for_timeout(150)
    pg.keyboard.press("Escape")
    n = int(pg.inner_text("#countNum"))
    exp4 = [f for f in expect if f["asset_class"] == "Equity"]
    check(n == len(exp4), f"4 table filters combine (AND): app {n} == expected {len(exp4)}")
    tags = pg.eval_on_selector_all("#activeBar .achip", "els => els.map(e => e.innerText.replace('\\n×',''))")
    check(len(tags) == 4, f"each table filter shows as a tag: {tags}")
    on = pg.eval_on_selector_all("#thead .thf.on", "els => els.map(e => e.dataset.filter)")
    check(set(on) == {"age", "rsi", "fee", "type"}, f"filtered columns highlighted: {on}")
    check(pg.input_value("#minAge") == "10", "table filter mirrored in Filters panel")
    pg.click("#activeBar .achip:has-text('Age') button"); pg.wait_for_timeout(150)
    check(len(pg.query_selector_all("#activeBar .achip")) == 3 and not pg.query_selector("#thead [data-filter='age'].on"), "removing the tag clears the column filter")
    pg.click("#clearAll"); pg.wait_for_timeout(100)

    # --- Czech
    pg.click("#langSeg [data-lang='cs']"); pg.wait_for_timeout(200)
    check(pg.inner_text("#toggleFilters").startswith("Filtry"), "Czech: toolbar translated")
    check("Řazení" in pg.inner_text("#sortBar"), "Czech: sort bar translated")
    fee_cell = pg.inner_text("#tbody tr[data-t='IVV'] td:nth-child(%d)" % header_index(pg, "Nákladovost"))
    check(fee_cell == "0,03\u00a0%", f"Czech: decimal comma + space before % ({fee_cell!r})")
    check(pg.evaluate("document.documentElement.lang") == "cs", "Czech: <html lang> updated")
    pg.reload(); pg.wait_for_selector("#tbody tr")
    check(pg.inner_text("#toggleFilters").startswith("Filtry"), "Czech choice remembered after reload")
    pg.click("#langSeg [data-lang='en']"); pg.wait_for_timeout(200)
    check(pg.inner_text("#toggleFilters").startswith("Filters"), "back to English")

    # --- dark + mobile
    dk = b.new_page(viewport={"width": 1440, "height": 900}, color_scheme="dark")
    dk.goto(URL); dk.wait_for_selector("#tbody tr"); dk.wait_for_timeout(700)
    dk.screenshot(path=f"{OUT}/v13-dark.png")
    mp = b.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mp.goto(URL); mp.wait_for_selector("#tbody tr"); mp.wait_for_timeout(700)
    sw = mp.evaluate("document.documentElement.scrollWidth")
    check(sw <= 390, f"no horizontal page scroll on mobile (scrollWidth {sw})")
    mp.screenshot(path=f"{OUT}/v13-mobile.png")
    mp.evaluate("document.querySelector('#tableView').scrollLeft = 300"); mp.wait_for_timeout(100)
    mp.screenshot(path=f"{OUT}/v13-mobile-scrolled.png")

    # --- reduced motion
    nm = b.new_page(); nm.goto(URL); nm.wait_for_selector("#tbody tr")
    nm.click("#tbody tr[data-t='IVV'] .nm"); nm.wait_for_timeout(300)
    bulls = nm.evaluate("[...document.querySelectorAll('img')].filter(i => /bull|mascot/.test(i.src)).length")
    check(bulls == 0, f"no mascot images on the page or in the fund panel ({bulls})")

    check(not errors, f"no console errors {errors}")
    b.close()
print("\nFAILURES:" if fails else "\nALL PASS", *fails, sep="\n  ")
