# Factsheeter

A local screener for US-listed iShares ETFs. You can filter and sort by return since inception, fund age, region/country/sector exposure, fees and fund size, and compare funds side by side. Every figure keeps its as-of date and links to the iShares product page and factsheet.

## Setup

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Import a snapshot

```sh
.venv/bin/python -m importer.ishares_us            # uses cache in data/cache if present
.venv/bin/python -m importer.ishares_us --refresh  # refetch everything (~10 min)
.venv/bin/python -m importer.ishares_us --limit 5  # quick test
```

Then fetch holdings and company descriptions (shown in each fund's side panel):

```sh
.venv/bin/python -m importer.holdings     # each fund's holdings file -> web/data/holdings/<TICKER>.json (~5 min)
.venv/bin/python -m importer.companies    # "what the company does" for every fund's top 10 (Wikidata/Wikipedia, ~15 min, resumable)
.venv/bin/python build_site.py            # static site for hosting -> dist/
```

Sources (no PDF parsing needed):

1. **iShares product-screener JSON**: a single request returns every fund's ISIN/CUSIP, fees, inception date, 1/3/5/10y and since-inception annualized returns (NAV and market price), fund size and primary region.
2. **Each product page**: the exposure breakdowns embedded in the page (sector, countries, plus maturity/rating for bond funds), each with an as-of date, and the factsheet PDF link.
3. **Each fund's holdings file** (`<product page>/latest-holdings.csv`): positions with weight, sector, country and exchange; bonds also maturity and coupon. The top 50 are kept per fund.
4. **Wikidata + Wikipedia** for company descriptions: matched by stock ticker and exchange first, then by name among listed companies. Unmatched companies show no description. Wikipedia text is CC BY-SA, Wikidata CC0; each description links to its Wikipedia article.

Region weights are **calculated** from country weights using `importer/regions.py`. Any country that isn't mapped is reported at the end of the import and counted as "Other".

The importer fetches 3 pages at a time with a pause between requests and retries, and only follows www.ishares.com URLs. It caches extracted data per fund, not whole pages.

## Run the app

```sh
.venv/bin/uvicorn app.main:app --reload
```

Then open http://127.0.0.1:8000. Filters, multi-column sorting and compare selections are saved in the URL, so a search can be bookmarked. Different filters combine with AND; options picked inside one filter combine with OR. Column visibility and language (EN/CS, defaults to the browser's language) are remembered per browser. Fund descriptions, country names and less common sector names come from iShares in English.

## Notes and caveats

- Returns are **annualized** and use **NAV** by default; you can switch to market price. Funds under 1 year old have no annualized figures, and funds under 5 years old get a "young" badge.
- Return filters exclude funds that don't have that period yet (for example, a 10-year filter excludes funds under 10 years old).
- The data is a snapshot. Check the source before investing. This is not investment advice.
- iShares/BlackRock data is subject to their terms of use. Check licensing before any public or commercial use.

## Layout

```
importer/   ishares_us.py (fetch + parse + SQLite), regions.py (country→region)
app/        main.py (FastAPI: /api/funds, /api/meta, serves web/)
web/        index.html, app.js, style.css (all filtering is client-side), i18n.js (English + Czech UI text), img/ (mascot + skyline photos)
mascot/     source mascot artwork + its README
data/       factsheeter.db, cache/ (gitignored)
research/   raw samples from the initial data investigation; screens/check.py = browser checks + screenshots
            (needs `.venv/bin/pip install playwright && .venv/bin/playwright install chromium`)
```

## Image credits

- `web/img/skyline-day.jpg`: "Lower Manhattan from Jersey City November 2014 panorama 2" by King of Hearts, CC BY-SA 3.0, via Wikimedia Commons (resized).
- `web/img/skyline-night.jpg`: "Lower Manhattan from Governors Island August 2017 panorama" by King of Hearts, CC BY-SA 4.0, via Wikimedia Commons (resized).
- `web/img/graphite-bull.webp`, `graphite-bull-sm.webp`: current Factsheeter mascot, cropped and resized from `mascot/factsheeter-graphite-bull.png`.
- `web/img/bull.png`: earlier plush mascot (not used by the page now), resized from `mascot/factsheeter-bull.png`.

The market clock uses regular trading hours only; exchange holidays are not included.
