""""What does this company do?" for each fund's largest holdings, from Wikidata + Wikipedia (openly licensed).

Matching, most reliable first:
  1. Wikidata items listed on a stock exchange (P414) with the same ticker (P249), checked against the
     holding's exchange or name.
  2. Wikidata name search, keeping only listed companies whose name is similar.
Then: Wikipedia's lead sentence(s) plus Wikidata industry (P452) and products (P1056).

Results are cached in data/cache/companies.json (misses too) and merged into web/data/holdings/*.json as an
"about" field. Unmatched companies simply show no description.
Usage:  .venv/bin/python -m importer.companies [--top N] [--refresh]
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import time

import httpx

from importer.holdings import OUT as HOLDINGS_DIR
from importer.ishares_us import DATA

CACHE = DATA / "cache" / "companies.json"
MATCHES = DATA / "cache" / "company_matches.json"   # key -> Wikidata id, or "" when nothing matched
UA = {"User-Agent": "factsheeter/0.1 (personal ETF research tool; low-rate)"}
WD_API = "https://www.wikidata.org/w/api.php"
SPARQL = "https://query.wikidata.org/sparql"
WP_API = "https://{lang}.wikipedia.org/w/api.php"
PAUSE = 0.6  # seconds between requests: Wikimedia asks for polite, sequential clients

SUFFIX = re.compile(
    r"\b(S\.?A\.?|PLC|AG|N\.?V\.?|SE|SPA|S\.P\.A\.?|INC|CORP(ORATION)?|LTD|LIMITED|HOLDINGS?|GROUP|CO|ASA|AB|OYJ|A/S|"
    r"CLASS [A-Z]|CL [A-Z]|ADR|REIT|NPV|REG|PREF|PRF|ORD|SHS|KGAA|SAB DE CV|TBK|BHD|PCL)\b\.?",
    re.I,
)


def clean(name: str) -> str:
    return re.sub(r"\s+", " ", SUFFIX.sub(" ", name.replace("&", " and "))).strip().lower()


def similar(a: str, b: str) -> float:
    a, b = clean(a), clean(b)
    if not a or not b:
        return 0.0
    if a in b or b in a:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def exch_match(ishares: str | None, wikidata: str) -> bool:
    if not ishares:
        return False
    norm = lambda s: set(re.findall(r"[a-z]+", s.lower())) - {"stock", "exchange", "the", "of", "market", "inc", "llc"}
    a, b = norm(ishares), norm(wikidata)
    return bool(a & b)


class Wiki:
    def __init__(self):
        self.c = httpx.Client(headers=UA, timeout=60)

    def get(self, url, pause=PAUSE, **params):
        for attempt in range(7):
            time.sleep(pause)
            r = self.c.get(url, params=params)
            if r.status_code == 200:
                return r.json()
            # 429/5xx: honour Retry-After, otherwise back off progressively
            wait = r.headers.get("Retry-After", "")
            wait = int(wait) if wait.isdigit() else 15 * (attempt + 1)
            print(f"    {r.status_code} from {url.split('/')[2]}, waiting {wait}s", flush=True)
            time.sleep(min(wait, 300))
        r.raise_for_status()

    def by_ticker(self, tickers: list[str]) -> dict[str, list[tuple]]:
        """ticker -> [(qid, item label, exchange label)] for items listed with that ticker."""
        vals = " ".join(json.dumps(t) for t in tickers)
        q = f"""SELECT ?t ?item ?itemLabel ?exLabel WHERE {{
          VALUES ?t {{ {vals} }}
          ?item p:P414 ?st . ?st pq:P249 ?t ; ps:P414 ?ex .
          SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }} }}"""
        data = self.get(SPARQL, query=q, format="json")
        out: dict[str, list[tuple]] = {}
        for b in data["results"]["bindings"]:
            out.setdefault(b["t"]["value"], []).append(
                (b["item"]["value"].rsplit("/", 1)[1], b["itemLabel"]["value"], b.get("exLabel", {}).get("value", "")))
        return out

    def search(self, name: str) -> list[str]:
        r = self.get(WD_API, pause=1.5, action="wbsearchentities", search=clean(name), language="en", type="item", limit=10, format="json")
        return [e["id"] for e in r.get("search", [])]

    def entities(self, qids: list[str]) -> dict:
        out = {}
        for i in range(0, len(qids), 50):
            r = self.get(WD_API, action="wbgetentities", ids="|".join(qids[i:i + 50]), props="labels|claims|sitelinks",
                         languages="en|cs", sitefilter="enwiki|cswiki", format="json")
            out.update(r.get("entities", {}))
        return out

    def labels(self, qids: list[str]) -> dict[str, dict[str, str]]:
        """qid -> {"en": label, "cs": label}"""
        out = {}
        for i in range(0, len(qids), 50):
            r = self.get(WD_API, action="wbgetentities", ids="|".join(qids[i:i + 50]), props="labels", languages="en|cs", format="json")
            for q, e in r.get("entities", {}).items():
                out[q] = {lang: v["value"] for lang, v in e.get("labels", {}).items()}
        return out

    def leads(self, titles: list[str], lang: str = "en") -> dict[str, str]:
        out = {}
        for i in range(0, len(titles), 20):
            r = self.get(WP_API.format(lang=lang), action="query", prop="extracts", exintro=1, explaintext=1, exsentences=5, redirects=1,
                         titles="|".join(titles[i:i + 20]), format="json")
            norm = {n["to"]: n["from"] for n in r["query"].get("normalized", []) + r["query"].get("redirects", [])}
            for p in r["query"].get("pages", {}).values():
                if p.get("extract"):
                    out[norm.get(p["title"], p["title"])] = p["extract"]
        return out


def claim_ids(ent: dict, prop: str) -> list[str]:
    return [c["mainsnak"]["datavalue"]["value"]["id"] for c in ent.get("claims", {}).get(prop, [])
            if c.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id")]


# Words that signal a sentence says what the company makes, sells or does.
DOES = re.compile(r"\b(design|develop|manufactur|produc|make|sell|operat|provid|offer|known for|specializ|"
                  r"supplie|retail|distribut|own|explor|refin|mine|mining|lend|insur|bank|brew|build|construct|"
                  r"generat|transmit|deliver|serv|market|research|invest|platform|software|devices?|stores?)\w*", re.I)


# Sentences about the share listing say nothing about the business.
LISTING = re.compile(r"\b(listed|stock exchange|index|indices|market capitali[sz]ation|shares|constituent|ticker)\b", re.I)


def lead_sentence(text: str) -> str:
    """Short 'what the company does' text from a Wikipedia intro.

    Starts from the first sentence without the company's legal name ("Orlen SA (…) is a Polish oil refiner …"
    -> "Polish oil refiner …"). If that sentence only says where the company is based, the first later
    sentence that names a product or activity is added ("designs graphics processors …")."""
    text = re.sub(r"\s*\([^()]*\)", "", text).strip()          # pronunciations, former names, tickers
    parts = [p.strip() for p in re.split(r"(?<=[a-z0-9\)]\.)\s+(?=[A-Z])", text) if p.strip()]
    if not parts:
        return ""
    first = parts[0]
    if len(first) < 70 and len(parts) > 1:                      # split inside an abbreviation such as "N.V."
        first += " " + parts.pop(1)
    m = re.search(r"\b(?:is|was|are) (?:an? |the )?", first[:220])
    if m:
        first = first[m.end():]
        first = first[:1].upper() + first[1:]
    first_does = DOES.search(re.sub(r"headquarter\w*.*", "", first))
    if not first_does:
        more = next((p for p in parts[1:] if DOES.search(p) and not LISTING.search(p)), None)
        if more:
            first = first.rstrip(".") + ". " + more
    return first[:360].strip()


# Czech equivalents: "X je polská rafinerská společnost …" -> "Polská rafinerská společnost …"
DOES_CS = re.compile(r"(vyráb|výrob|vyvíj|prodáv|provozuj|poskytuj|nabíz|zabýv|specializ|distribu|těž|rafin|bank|"
                     r"pojišť|obchod|prodej|stav|energ|dodáv|služb|software|platform|zaměř|vlastní|čip|polovodič)", re.I)
LISTING_CS = re.compile(r"(kótov|burz|index|akci[eí]|tržní kapitalizac)", re.I)


def lead_sentence_cs(text: str) -> str:
    text = re.sub(r"\s*\([^()]*\)", "", text).strip()
    parts = [p.strip() for p in re.split(r"(?<=[a-zá-ž0-9\)]\.)\s+(?=[A-ZÁ-Ž])", text) if p.strip()]
    if not parts:
        return ""
    first = parts[0]
    if len(first) < 60 and len(parts) > 1:
        first += " " + parts.pop(1)
    m = re.search(r"\s(?:je|jsou|byla|byl|bylo)\s", first[:220])
    if m:
        first = first[m.end():]
        first = first[:1].upper() + first[1:]
    if not DOES_CS.search(re.sub(r"(se )?sídl\w*.*", "", first)):
        more = next((p for p in parts[1:] if DOES_CS.search(p) and not LISTING_CS.search(p)), None)
        if more:
            first = first.rstrip(".") + ". " + more
    return first[:360].strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=10, help="describe each fund's N largest equity holdings")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--redescribe", action="store_true",
                    help="re-download Wikipedia/Wikidata details for companies already matched")
    ap.add_argument("--skip-names", action="store_true",
                    help="only match by ticker (fast); the slower name search can run later and resumes where it stopped")
    args = ap.parse_args()

    cache = {} if args.refresh or not CACHE.exists() else json.loads(CACHE.read_text())
    files = sorted(HOLDINGS_DIR.glob("*.json"))
    wanted: dict[str, dict] = {}
    for f in files:
        for h in json.loads(f.read_text())["holdings"][: args.top]:
            if h.get("asset_class") == "Equity" and h["ticker"] not in ("", "-"):
                wanted.setdefault(f"{h['ticker']}|{h['name']}", h)
    todo = {k: h for k, h in wanted.items() if k not in cache or (args.redescribe and cache[k])}
    print(f"{len(wanted)} companies in the top {args.top} of {len(files)} funds; {len(todo)} to look up")

    wiki = Wiki()
    saved = {} if args.refresh or not MATCHES.exists() else json.loads(MATCHES.read_text())
    match: dict[str, str] = {k: v for k, v in saved.items() if v}
    tried_name = {k for k, v in saved.items() if v == ""}
    save = lambda: MATCHES.write_text(json.dumps({**{k: "" for k in tried_name}, **match}))
    # 1. ticker + exchange
    keys = list(todo)
    pending = [k for k in keys if k not in saved]
    for i in range(0, len(pending), 80):
        batch = pending[i:i + 80]
        found = wiki.by_ticker(sorted({todo[k]["ticker"] for k in batch}))
        for k in batch:
            h = todo[k]
            cands = found.get(h["ticker"], [])
            best = [c for c in cands if exch_match(h.get("exchange"), c[2]) and similar(h["name"], c[1]) > 0.35]
            best = best or [c for c in cands if similar(h["name"], c[1]) > 0.75]
            if best:
                match[k] = best[0][0]
        save()
        print(f"  by ticker: {min(i + 80, len(pending))}/{len(pending)} looked up, {len(match)} matched", flush=True)
    # 2. name search for the rest (listed companies only)
    rest = [] if args.skip_names else [k for k in keys if k not in match and k not in tried_name]
    for n, k in enumerate(rest, 1):
        ids = wiki.search(todo[k]["name"])
        if ids:
            ents = wiki.entities(ids)
            for q in ids:
                e = ents.get(q, {})
                lab = e.get("labels", {}).get("en", {}).get("value", "")
                if e.get("claims", {}).get("P414") and similar(todo[k]["name"], lab) > 0.6:
                    match[k] = q
                    break
        if k not in match:
            tried_name.add(k)
        if n % 25 == 0 or n == len(rest):
            save()
            print(f"  by name: {n}/{len(rest)}, {len(match)} matched in total", flush=True)

    # 3. details for matched items
    ents = wiki.entities(sorted(set(match.values())))
    extra = sorted({q for e in ents.values() for p in ("P452", "P1056") for q in claim_ids(e, p)})
    labels = wiki.labels(extra)
    titles = {q: e.get("sitelinks", {}).get("enwiki", {}).get("title") for q, e in ents.items()}
    titles_cs = {q: e.get("sitelinks", {}).get("cswiki", {}).get("title") for q, e in ents.items()}
    leads = wiki.leads(sorted({t for t in titles.values() if t}))
    leads_cs = wiki.leads(sorted({t for t in titles_cs.values() if t}), "cs")
    lab = lambda ids, lang: list(dict.fromkeys(labels[i][lang] for i in ids if lang in labels.get(i, {})))
    for k in todo:
        q = match.get(k)
        if not q:
            if not args.skip_names:
                cache[k] = None
            continue
        e, title, title_cs = ents.get(q, {}), titles.get(q), titles_cs.get(q)
        cache[k] = {
            "qid": q,
            "label": e.get("labels", {}).get("en", {}).get("value"),
            "wiki": title,
            "lead": leads.get(title) if title else None,   # raw intro, so wording rules can change offline
            "summary": lead_sentence(leads.get(title, "")) if title else None,
            "industry": lab(claim_ids(e, "P452"), "en")[:3],
            "products": lab(claim_ids(e, "P1056"), "en")[:5],
            "wiki_cs": title_cs,
            "lead_cs": leads_cs.get(title_cs) if title_cs else None,
            "industry_cs": lab(claim_ids(e, "P452"), "cs")[:3],
            "products_cs": lab(claim_ids(e, "P1056"), "cs")[:5],
        }
    for v in cache.values():
        if v and v.get("lead"):
            v["summary"] = lead_sentence(v["lead"])
        if v and v.get("lead_cs"):
            v["summary_cs"] = lead_sentence_cs(v["lead_cs"])
    CACHE.write_text(json.dumps(cache, indent=0))

    # 4. merge into the per-fund holdings files
    described = 0
    for f in files:
        data = json.loads(f.read_text())
        for h in data["holdings"]:
            about = cache.get(f"{h['ticker']}|{h['name']}")
            h.pop("about", None)
            if about and (about.get("summary") or about.get("industry") or about.get("products")):
                h["about"] = {k: v for k, v in about.items() if k not in ("lead", "lead_cs") and v not in (None, [], "")}
                described += 1
        f.write_text(json.dumps(data, separators=(",", ":")))
    hits = sum(1 for k in wanted if cache.get(k))
    print(f"Done: {hits}/{len(wanted)} companies matched; {described} holdings rows now have a description")
    return 0


if __name__ == "__main__":
    sys.exit(main())
