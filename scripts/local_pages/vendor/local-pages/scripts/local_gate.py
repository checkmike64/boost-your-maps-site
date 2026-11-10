# Vendored from Impact-Leads-LLC/ai-skills@65477e047fc2 shared/local-pages/scripts/local_gate.py (2026-11-10). Do not edit here: change the skill, then run scripts/local_pages/sync_local_gate.py.
#!/usr/bin/env python3
"""Gate for local / service-area pages built with shared/local-pages.

  python3 -I local_gate.py --data page-data.json --file page.html [--siblings DIR] [--json] [--config site.json]
  python3 -I local_gate.py --data page-data.json --plan [--json]      # before writing: build check + module minimums

Exit 0 = pass, 1 = fail (blocking findings), 2 = usage or input error.

Gates (references/gates.md):
  G1 data floor     unique sourced data points on the page, by module, vs siblings
  G2 sourcing       every fact has a source and a date; every number on the page resolves to a fact
  G3 city swap      sentences in the data sections carry a page-specific data point; each data
                    section opens with one
  G4 similarity     5-word shingle Jaccard vs every sibling page (fixed blocks and headings excluded)
  G5 filler         banned topics (census, landmarks, roads, weather, permits, utilities, tourism),
                    place lists, embedded maps
  G7 build check    the "when not to build" rules, from page-data build_check
  G8 proof          borrowed proof is labeled; proof never sits next to a rank claim it lacks
Standard library only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = SKILL / "config.json"
TODAY = dt.date.today()
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
BLOCK_TAGS = {"p", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "div", "section", "article",
              "blockquote", "figcaption", "dd", "dt", "table", "ul", "ol", "br", "header",
              "footer", "aside", "summary", "details", "caption", "form", "label", "button"}
SKIP_TAGS = {"script", "style", "select", "svg", "noscript", "template", "iframe"}
INLINE_GAP_TAGS = {"span", "small", "strong", "b", "em", "i", "a", "cite", "time", "q", "abbr", "mark"}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source",
             "track", "wbr"}
NUM_RE = re.compile(r"(?<![\w.])\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?%?(?![\w])")
PHONE_RE = re.compile(r"\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b")


class UsageError(Exception):
    pass


# ------------------------------------------------------------------ text helpers
def norm(s: str) -> str:
    s = html.unescape(str(s))
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip().lower()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")


def words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9$']+", norm(s))


def sentences(block: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'$(])", block.strip())
    return [p.strip() for p in parts if p.strip()]


def numbers_in(s: str) -> list[float]:
    out = []
    for m in NUM_RE.finditer(s):
        whole = m.group(1).replace(",", "")
        frac = m.group(2)
        out.append(float(f"{whole}.{frac}" if frac else whole))
    return out


def parse_date(v) -> dt.date | None:
    if not v:
        return None
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def date_variants(d: dt.date) -> list[str]:
    full = MONTHS[d.month - 1]
    short = full[:3]
    return [d.isoformat(), f"{full} {d.day}, {d.year}", f"{short} {d.day}, {d.year}",
            f"{short}. {d.day}, {d.year}", f"{d.day} {full} {d.year}", f"{full} {d.day}"]


def month_index(v) -> int | None:
    s = norm(v)
    m = re.match(r"^(\d{4})-(\d{2})$", s)
    if m:
        return int(m.group(2))
    for i, name in enumerate(MONTHS):
        if s.startswith(name[:3]):
            return i + 1
    return None


# ------------------------------------------------------------------ HTML reading
class Block:
    __slots__ = ("kind", "text", "fixed", "heading", "level", "list_id", "in_list")

    def __init__(self, kind, text, fixed, heading, level, list_id):
        self.kind, self.text, self.fixed, self.heading = kind, text, fixed, heading
        self.level, self.list_id = level, list_id


class PageParser(HTMLParser):
    """Collects visible text blocks inside <main> (or <body>) with heading context and fixed flags."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.has_main = False
        self.in_main = 0
        self.in_body = 0
        self.skip = 0
        self.generated = 0
        self.fixed_comment = 0
        self.stack: list[tuple[str, bool]] = []
        self.buf: list[str] = []
        self.blocks: list[Block] = []
        self.cur_heading = ""
        self.cur_level = 0
        self.head_tag = None
        self.list_stack: list[int] = []
        self.list_counter = 0
        self.iframes: list[str] = []
        self.row_cells: list[str] | None = None

    # visibility scope
    def _collecting(self) -> bool:
        if self.skip or self.generated:
            return False
        return self.in_main > 0 if self.has_main else self.in_body > 0

    def _fixed(self) -> bool:
        return self.fixed_comment > 0 or any(f for _, f in self.stack)

    def flush(self):
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip().strip("| ").strip()
        self.buf = []
        if not text or not self._collecting():
            return
        kind = self.head_tag or "text"
        self.blocks.append(Block(kind, text, self._fixed(), self.cur_heading, self.cur_level,
                                 self.list_stack[-1] if self.list_stack else None))

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in INLINE_GAP_TAGS and self._collecting():
            self.buf.append(" ")
        if tag == "main":
            self.in_main += 1
        if tag == "body":
            self.in_body += 1
        if tag == "iframe" and self._collecting():
            self.iframes.append(a.get("src") or "")
        if tag in SKIP_TAGS:
            self.flush()
            self.skip += 1
            return
        if tag in BLOCK_TAGS:
            self.flush()
        if tag in ("td", "th") and self._collecting():
            self.buf.append(" | ")
        if tag in ("ul", "ol"):
            self.list_counter += 1
            self.list_stack.append(self.list_counter)
        if tag in ("h1", "h2", "h3", "h4"):
            self.head_tag = tag
        if tag not in VOID_TAGS:
            self.stack.append((tag, "data-fixed" in a))

    def handle_endtag(self, tag):
        if tag in INLINE_GAP_TAGS and self._collecting():
            self.buf.append(" ")
        if tag in SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
            return
        if tag in BLOCK_TAGS:
            if tag in ("h1", "h2", "h3", "h4") and self.head_tag == tag:
                text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
                self.flush()
                if tag in ("h1", "h2"):
                    self.cur_heading, self.cur_level = text, int(tag[1])
                self.head_tag = None
            else:
                self.flush()
        if tag in ("ul", "ol") and self.list_stack:
            self.list_stack.pop()
        if any(t == tag for t, _ in self.stack):
            while self.stack:
                t, _ = self.stack.pop()
                if t == tag:
                    break
        if tag == "main":
            self.in_main = max(0, self.in_main - 1)
        if tag == "body":
            self.in_body = max(0, self.in_body - 1)

    def handle_startendtag(self, tag, attrs):
        if tag == "br":
            self.buf.append(" ")

    def handle_data(self, data):
        if self._collecting():
            self.buf.append(data)

    def handle_comment(self, data):
        d = data.strip().lower()
        if d.startswith("generated:start"):
            self.flush()
            self.generated += 1
        elif d.startswith("generated:end"):
            self.generated = max(0, self.generated - 1)
        elif d.startswith("fixed:start"):
            self.flush()
            self.fixed_comment += 1
        elif d.startswith("fixed:end"):
            self.flush()
            self.fixed_comment = max(0, self.fixed_comment - 1)


def read_page(path: Path) -> dict:
    src = path.read_text(encoding="utf-8", errors="replace")
    p = PageParser()
    p.has_main = bool(re.search(r"<main\b", src, re.I))
    p.feed(src)
    p.flush()
    meta = {}
    m = re.search(r"<!--\s*page-meta\b(.*?)-->", src, re.S)
    if m:
        meta = dict(re.findall(r'([a-z_]+)="([^"]*)"', m.group(1)))
    blocks = p.blocks
    full = " \n".join(b.text for b in blocks)
    prose = " \n".join(b.text for b in blocks if not b.fixed and b.kind == "text")
    return {"path": str(path), "src": src, "blocks": blocks, "text": full, "prose": prose,
            "iframes": p.iframes, "meta": meta, "placeholders": re.findall(r"\{\{[^}]*\}\}|\[PENDING[^\]]*\]", src)}


# ------------------------------------------------------------------ facts
def fact_matchers(f: dict) -> list[tuple[str, object]]:
    unit = norm(f.get("unit", ""))
    value = f.get("value")
    out: list[tuple[str, object]] = []
    if f.get("display"):
        disp = f["display"] if isinstance(f["display"], list) else [f["display"]]
        out += [("text", norm(d)) for d in disp if str(d).strip()]
    if value is None or str(value).strip() == "":
        return out
    if unit in ("name", "text", "quote", "question", "phrase"):
        out.append(("text", norm(value)))
    elif unit == "date":
        d = parse_date(value)
        out.append(("date", d) if d else ("text", norm(value)))
    elif unit == "month":
        mi = month_index(value)
        out.append(("month", mi) if mi else ("text", norm(value)))
    else:
        try:
            out.append(("num", float(str(value).replace(",", "").replace("$", "").replace("%", ""))))
        except ValueError:
            out.append(("text", norm(value)))
    return out


def match_in(matchers, text_norm: str, nums: list[float]) -> bool:
    for kind, tok in matchers:
        if kind == "text" and tok:
            pat = (r"\b" if tok[0].isalnum() else "") + re.escape(tok) + (r"\b" if tok[-1].isalnum() else "")
            if re.search(pat, text_norm):
                return True
        elif kind == "num":
            if any(abs(n - tok) < 0.005 for n in nums):
                return True
        elif kind == "date":
            if any(v in text_norm for v in date_variants(tok)):
                return True
        elif kind == "month":
            name = MONTHS[tok - 1]
            if re.search(r"\b(%s|%s)\b" % (name, name[:3]), text_norm):
                return True
    return False


class TextIndex:
    def __init__(self, text: str):
        self.norm = norm(text)
        self.nums = numbers_in(self.norm)

    def has(self, matchers) -> bool:
        return match_in(matchers, self.norm, self.nums)


# ------------------------------------------------------------------ report
class Report:
    def __init__(self):
        self.errors: list[dict] = []
        self.warnings: list[dict] = []
        self.notes: list[dict] = []
        self.stats: dict = {}

    def err(self, gate, msg):
        self.errors.append({"gate": gate, "msg": msg})

    def warn(self, gate, msg):
        self.warnings.append({"gate": gate, "msg": msg})

    def note(self, gate, msg):
        self.notes.append({"gate": gate, "msg": msg})


# ------------------------------------------------------------------ checks on data alone
REQUIRED_TOP = ("site_key", "slug", "city", "region", "service", "modules")


def check_data(data: dict, cfg: dict, r: Report) -> None:
    for k in REQUIRED_TOP:
        if k not in data or data[k] in (None, ""):
            r.err("schema", f"page-data is missing '{k}'")
    profile = data.get("profile", "owner-report")
    if profile not in cfg["profiles"]:
        r.err("schema", f"profile '{profile}' is not one of {sorted(cfg['profiles'])}")
    mods = data.get("modules") or {}
    if not isinstance(mods, dict):
        r.err("schema", "modules must be an object keyed by module id")
        return
    sc = cfg["sourcing"]
    for mid, mod in mods.items():
        if mid not in cfg["modules"]:
            r.err("schema", f"unknown module '{mid}' (known: {', '.join(cfg['modules'])})")
            continue
        if not isinstance(mod, dict) or "included" not in mod:
            r.err("schema", f"module '{mid}' needs 'included' (true/false) and 'reason'")
            continue
        if not mod.get("reason"):
            r.warn("schema", f"module '{mid}' has no 'reason' (say why it is in or out)")
        if not mod.get("included"):
            continue
        for i, f in enumerate(mod.get("facts") or []):
            where = f"{mid}.facts[{i}]" + (f" ({f['id']})" if f.get("id") else "")
            if not f.get("text"):
                r.err("G2", f"{where}: fact has no 'text'")
            if f.get("value") in (None, "") and not f.get("display"):
                r.err("G2", f"{where}: fact has no 'value' (the token that appears on the page)")
            if not f.get("source"):
                r.err("G2", f"{where}: fact has no 'source'")
            first_party = bool(f.get("first_party")) and sc.get("first_party_sources_ok_without_url", True)
            if not f.get("source_url") and not first_party and mid != "offer":
                r.err("G2", f"{where}: fact has no 'source_url' (or mark it first_party: true with the system named in 'source')")
            got = parse_date(f.get("retrieved_on"))
            if not got:
                r.err("G2", f"{where}: 'retrieved_on' must be a YYYY-MM-DD date")
            else:
                age = (TODAY - got).days
                if age > sc["fail_age_days"]:
                    r.err("G2", f"{where}: data is {age} days old (limit {sc['fail_age_days']}); pull it again")
                elif age > sc["warn_age_days"]:
                    r.warn("G2", f"{where}: data is {age} days old; refresh before the next release")
        check_module_minimum(mid, mod, cfg, r, cfg["profiles"].get(profile, {}))


def check_module_minimum(mid: str, mod: dict, cfg: dict, r: Report, pcfg: dict | None = None) -> None:
    mc = cfg["modules"][mid]
    facts = mod.get("facts") or []
    meta = mod.get("meta") or {}
    drop = "drop the module (included: false) instead of padding it"
    internal_map = mid == "map" and not (pcfg or {}).get("competitor_names_allowed", True)
    if len(facts) < mc.get("min_facts", 0) and not internal_map:
        r.err("G1", f"{mid}: {len(facts)} facts, minimum {mc['min_facts']}; {drop}")
    if mid == "map":
        names = [f for f in facts if norm(f.get("unit", "")) == "name"]
        if len(names) < mc["min_results"] and not internal_map:
            r.err("G1", f"map: {len(names)} businesses named, minimum {mc['min_results']}; {drop}")
        for k in ("query", "searched_on", "from"):
            if not meta.get(k):
                r.err("G1", f"map: meta.{k} is required (the page states the exact search, the date and where it ran from)")
        depth = meta.get("depth")
        if not internal_map and (depth is None or int(depth) < mc["depth_min"]):
            r.warn("G1", f"map: read depth {depth} is under {mc['depth_min']}; read the same search to {mc['depth_target']} so the observations stand on more than three rows")
    elif mid == "first_party":
        if int(meta.get("jobs_12m", 0) or 0) < mc["min_jobs_12m"]:
            r.err("G1", f"first_party: meta.jobs_12m under {mc['min_jobs_12m']}; {drop}")
    elif mid == "demand":
        core = int(meta.get("core_avg_monthly", 0) or 0)
        terms = int(meta.get("terms_with_data", 0) or 0)
        if core < mc["core_min_monthly"] and terms < mc["terms_with_data_min"]:
            r.err("G1", f"demand: core group {core}/mo and {terms} terms with data; needs {mc['core_min_monthly']}/mo or {mc['terms_with_data_min']} terms; {drop}")
    elif mid == "reviews":
        if int(meta.get("sample_size", 0) or 0) < mc["sample_min"]:
            r.err("G1", f"reviews: meta.sample_size under {mc['sample_min']}; {drop}")
        if int(meta.get("businesses", 0) or 0) < mc["businesses_min"]:
            r.err("G1", f"reviews: themes need reviews from {mc['businesses_min']} or more businesses")
        for i, f in enumerate(facts):
            if norm(f.get("unit", "")) == "quote":
                rd = parse_date(f.get("review_date"))
                if not rd:
                    r.err("G1", f"reviews.facts[{i}]: a quoted review needs review_date")
                elif (TODAY - rd).days > mc["max_age_months"] * 30.5:
                    r.err("G1", f"reviews.facts[{i}]: review from {rd} is older than {mc['max_age_months']} months; never quote it")
    elif mid == "proof":
        lvl = meta.get("match_level")
        if lvl not in (1, 2, 3, 4):
            r.err("G8", "proof: meta.match_level must be 1 (same service and city), 2 (same service), 3 (same city) or 4 (nearest example)")
        if meta.get("approved") is not True:
            r.err("G8", "proof: meta.approved must be true (only approved proof rows or the client's own results)")
        if lvl in (2, 3, 4) and not meta.get("label_text"):
            r.err("G8", "proof: borrowed proof needs meta.label_text, the words on the page that say where it is from")
    elif mid == "price":
        if int(meta.get("price_tags", 0) or 0) < mc["price_tags_min"] and not meta.get("client_published"):
            r.err("G1", f"price: under {mc['price_tags_min']} price tags and no client-published price; {drop}")


def check_build(data: dict, cfg: dict, r: Report, plan_mode: bool) -> None:
    bc = data.get("build_check")
    gate = "G7"
    if not bc:
        (r.err if plan_mode else r.warn)(gate, "no build_check in page-data; fill it and run --plan before writing")
        return
    profile = data.get("profile", "owner-report")
    rules = cfg["build_rules"].get(profile, {})
    stop = []

    def need(key):
        if key not in bc:
            r.err(gate, f"build_check.{key} is missing")
            return None
        return bc[key]

    demand = need("demand_core_monthly")
    if demand is not None:
        demand = int(demand or 0)
        if profile == "buyer-page":
            gsc = int(bc.get("gsc_impressions_90d", 0) or 0)
            fp = int(bc.get("first_party_count", 0) or 0)
            if demand < rules["demand_min_monthly"] and gsc < rules["gsc_impressions_90d_min"] and fp < rules["first_party_min"]:
                stop.append(f"no demand: {demand}/mo (min {rules['demand_min_monthly']}), {gsc} GSC impressions in 90 days (min {rules['gsc_impressions_90d_min']}) and {fp} customers there (min {rules['first_party_min']})")
        else:
            prospects = int(bc.get("prospects_in_city", 0) or 0)
            lvl = bc.get("proof_match_level")
            if demand < rules["demand_min_monthly"] and prospects == 0 and lvl not in (1, 3):
                stop.append(f"no demand: core group {demand}/mo (min {rules['demand_min_monthly']}) and no prospect or proof in the city")
    lvl = bc.get("proof_match_level")
    snap = parse_date(bc.get("snapshot_date"))
    fresh = snap is not None and (TODAY - snap).days <= rules.get("snapshot_fresh_days", 30)
    if lvl not in rules.get("proof_levels_that_count", [1, 2, 3]) and not fresh:
        stop.append("no proof in the trade or the city and no Maps snapshot from the last "
                    f"{rules.get('snapshot_fresh_days', 30)} days")
    spacing = float(bc.get("grid_spacing_km") or cfg["build_rules"]["default_grid_spacing_km"])
    near = bc.get("nearest_page_km")
    if near is not None and float(near) < spacing:
        stop.append(f"too close: another page sits {near} km away, inside one grid spacing ({spacing} km); merge into it")
    ov = bc.get("serp_overlap") or {}
    org = int(ov.get("organic_shared_top10") or 0)
    mp = int(ov.get("maps_shared_top3") or 0)
    if ov and org >= rules["serp_overlap_organic_top10"] and mp >= rules["serp_overlap_maps_top3"]:
        stop.append(f"same market as {ov.get('sibling', 'a sibling page')}: {org} of the top 10 sites and {mp} of the top three on Maps are shared")
    if rules.get("require_parent_hub", True):
        hub = need("parent_hub_live")
        if hub is False:
            stop.append(f"no live parent hub ({data.get('parent_hub', 'set parent_hub')}); build the hub first")
    if bc.get("serves_area") is False:
        stop.append("the business does not serve this area")
    if bc.get("publishing_paused") is True:
        stop.append("publishing is paused by a Search Console signal")
    for s in stop:
        r.err(gate, f"do not build: {s}")
    r.stats["build_check"] = "stop" if stop else "build"


# ------------------------------------------------------------------ checks on the page
def heading_regex(pattern: str, data: dict) -> re.Pattern:
    out = []
    for alt in pattern.split("|"):
        rx = re.escape(norm(alt))
        for key in ("city", "service", "region"):
            rx = rx.replace(re.escape("{%s}" % key), re.escape(norm(data.get(key, ""))))
        rx = rx.replace(re.escape(".+"), ".+").replace(re.escape(".*"), ".*")
        out.append(rx)
    return re.compile(r"^(?:%s)$" % "|".join(out))


def map_sections(page: dict, data: dict, cfg: dict) -> list[dict]:
    """Group blocks into sections by H2, and map each to a skeleton slot."""
    sections: list[dict] = []
    cur = None
    for b in page["blocks"]:
        if b.kind in ("h1", "h2"):
            cur = {"heading": b.text, "level": int(b.kind[1]), "blocks": [], "slot": None}
            sections.append(cur)
            continue
        if cur is None:
            cur = {"heading": "", "level": 0, "blocks": [], "slot": None}
            sections.append(cur)
        cur["blocks"].append(b)
    slots = [s for s in cfg["skeleton"] if s["h"] == "h2" and s["pattern"] != ".+"]
    h2s = [s for s in sections if s["level"] == 2]
    for s in sections:
        if s["level"] == 1:
            s["slot"] = 1
        elif s["level"] == 2:
            h = norm(s["heading"])
            for sl in slots:
                if heading_regex(sl["pattern"], data).match(h):
                    s["slot"] = sl["slot"]
                    break
            if s["slot"] is None and h2s and s is h2s[-1]:
                s["slot"] = 8
    return sections


def check_page(page: dict, data: dict, cfg: dict, siblings: list[dict], r: Report) -> None:
    profile = data.get("profile", "owner-report")
    pcfg = cfg["profiles"].get(profile, {})
    is_hub = data.get("page_type", "city") == "hub"
    idx = TextIndex(page["text"])
    mods = data.get("modules") or {}

    if page["placeholders"]:
        r.err("G2", f"template leftovers on the page: {', '.join(sorted(set(page['placeholders']))[:5])}")

    # ---- facts found on the page, uniqueness vs siblings
    sib_idx = [TextIndex(s["text"]) for s in siblings]
    data_tokens: list[list] = []
    found_by_module: dict[str, int] = {}
    unique_by_module: dict[str, int] = {}
    present_modules = []
    for mid, mod in mods.items():
        if mid not in cfg["modules"] or not mod.get("included"):
            continue
        counts = cfg["modules"][mid]["counts"]
        nfound = nuniq = 0
        for f in mod.get("facts") or []:
            m = fact_matchers(f)
            if not m or not idx.has(m):
                continue
            nfound += 1
            unit = norm(f.get("unit", ""))
            if counts and unit != "question":
                data_tokens.append(m)
                if not any(s.has(m) for s in sib_idx):
                    nuniq += 1
        found_by_module[mid] = nfound
        if counts:
            unique_by_module[mid] = nuniq
            mc = cfg["modules"][mid]
            if nfound >= max(1, min(mc.get("min_facts", 1), len(mod.get("facts") or []))):
                present_modules.append(mid)
        internal = mid == "map" and not pcfg.get("competitor_names_allowed", True)
        if counts and nfound == 0 and not internal:
            r.warn("G1", f"{mid}: included but none of its facts appear on the page")
    total_unique = sum(unique_by_module.values())
    r.stats.update({"facts_found": found_by_module, "unique_data_points": unique_by_module,
                    "unique_total": total_unique, "data_modules_present": present_modules})
    fl = cfg["floor"]
    if not is_hub:
        if total_unique < fl["min_unique_data_points"] or len(present_modules) < fl["min_data_modules"]:
            r.err("G1", f"data floor: {total_unique} unique sourced data points from {len(present_modules)} modules "
                        f"({', '.join(present_modules) or 'none'}); needs {fl['min_unique_data_points']} from {fl['min_data_modules']}. "
                        "Pull more local data or do not build the page")

    # ---- G2: every number on the page resolves to a fact
    sourced: set[float] = set()
    date_strings: list[str] = []
    for mid, mod in mods.items():
        if not mod.get("included"):
            continue
        for f in mod.get("facts") or []:
            for field in ("value", "display", "text"):
                v = f.get(field)
                for item in (v if isinstance(v, list) else [v]):
                    if item is not None:
                        sourced.update(numbers_in(norm(item)))
            for field in ("retrieved_on", "review_date", "value"):
                d = parse_date(f.get(field)) if field != "value" or norm(f.get("unit", "")) == "date" else None
                if d:
                    date_strings += date_variants(d)
                    sourced.update({float(d.year), float(d.day)})
    for k in ("published", "modified", "built_on"):
        d = parse_date(data.get(k))
        if d:
            date_strings += date_variants(d)
            sourced.update({float(d.year), float(d.day)})
    for k in ("address", "phone", "name"):
        v = (data.get("business") or {}).get(k)
        if v:
            sourced.update(numbers_in(norm(v)))
    text = norm(page["text"])
    for ds in sorted(set(date_strings), key=len, reverse=True):
        text = text.replace(ds, " ")
    text = PHONE_RE.sub(" ", text)
    small = cfg["sourcing"]["ignore_small_integers_upto"]
    unsourced = []
    for m in NUM_RE.finditer(text):
        whole = m.group(1).replace(",", "")
        val = float(f"{whole}.{m.group(2)}" if m.group(2) else whole)
        if val == int(val) and 0 <= val <= small:
            continue
        if any(abs(val - s) < 0.005 for s in sourced):
            continue
        unsourced.append(text[max(0, m.start() - 40):m.end() + 30].strip())
    for ctx in unsourced[:12]:
        r.err("G2", f"number with no fact behind it: ...{ctx}...")
    if len(unsourced) > 12:
        r.err("G2", f"... and {len(unsourced) - 12} more unsourced numbers")

    # ---- skeleton + G3 city swap
    sections = map_sections(page, data, cfg)
    if not is_hub:
        if not any(s["level"] == 1 for s in sections):
            r.err("skeleton", "no H1 on the page")
        order = [s["slot"] for s in sections if s["slot"] is not None]
        if order != sorted(order):
            r.err("skeleton", f"sections are out of the fixed order (slots {order})")
        for s in sections:
            if s["level"] == 2 and s["slot"] is None:
                r.err("skeleton", f"H2 '{s['heading']}' does not follow a fixed H2 pattern in the skeleton")
        data_slots = {sl["slot"] for sl in cfg["skeleton"] if sl.get("data_slot")}
        sw = cfg["swap_test"]
        total = carrying = 0
        survivors = []
        for s in sections:
            if s["slot"] not in data_slots:
                continue
            first_checked = False
            for b in s["blocks"]:
                if b.fixed or b.kind != "text":
                    continue
                for sent in sentences(b.text):
                    if len(words(sent)) < sw["min_sentence_words"]:
                        continue
                    si = TextIndex(sent)
                    has = any(si.has(m) for m in data_tokens)
                    total += 1
                    carrying += has
                    if not has:
                        survivors.append(sent)
                    if not first_checked:
                        first_checked = True
                        if sw["first_sentence_must_carry_data"] and not has:
                            r.err("G3", f"section '{s['heading']}' opens without a local data point: \"{sent[:120]}\"")
        share = (carrying / total) if total else 0.0
        r.stats["swap_test"] = {"data_sentences": carrying, "sentences": total, "share": round(share, 3)}
        if total == 0:
            r.err("G3", "no data sections found (slots 2-5 and 7); the page has nothing local to test")
        elif share < sw["min_data_sentence_share"]:
            r.err("G3", f"city swap: only {share:.0%} of sentences in the data sections carry a local data point "
                        f"(min {sw['min_data_sentence_share']:.0%}); these would stay true in any city:")
            for sent in survivors[:6]:
                r.err("G3", f"  \"{sent[:140]}\"")
        elif survivors:
            r.note("G3", f"{len(survivors)} sentences would survive a city swap; check each one earns its place")

    # ---- fixed text cap and length band
    fixed_words = sum(len(words(b.text)) for b in page["blocks"] if b.fixed)
    all_words = len(words(page["text"]))
    r.stats.update({"words": all_words, "fixed_words": fixed_words})
    if fixed_words > cfg["fixed_text_max_words"]:
        r.warn("G4", f"fixed blocks hold {fixed_words} words (cap {cfg['fixed_text_max_words']}); move shared explanations to the hub")
    if not is_hub and not (pcfg.get("words_min", 0) <= all_words <= pcfg.get("words_max", 10 ** 6)):
        r.warn("length", f"{all_words} words of main content; this profile usually lands at {pcfg.get('words_min')}-{pcfg.get('words_max')}. "
                         "No word target: let the data set the length, never pad")

    # ---- G4 similarity
    simc = cfg["similarity"]
    n = simc["shingle_size"]
    mine = shingle_set(page["prose"], n)
    worst = []
    for s in siblings:
        other = shingle_set(s["prose"], n)
        if not mine or not other:
            continue
        jac = len(mine & other) / len(mine | other)
        close = sibling_related(data, s)
        limit = simc["same_service_or_city_max"] if close else simc["any_page_max"]
        worst.append((jac, s["path"], close))
        if jac > limit:
            r.err("G4", f"{jac:.1%} 5-word overlap with {s['path']} (limit {limit:.0%}"
                        f"{', same service or city' if close else ''}); rewrite the flagged sections from this page's data")
    if worst:
        worst.sort(reverse=True)
        r.stats["similarity_max"] = {"jaccard": round(worst[0][0], 4), "sibling": worst[0][1]}

    # ---- G5 filler
    check_filler(page, data, cfg, r, is_hub)

    # ---- profile rules
    if not pcfg.get("competitor_names_allowed", True):
        for f in (mods.get("map") or {}).get("facts") or []:
            if norm(f.get("unit", "")) == "name" and idx.has(fact_matchers(f)):
                r.err("profile", f"'{f.get('value')}' is a competitor from the map read; client pages never name competitors")

    # ---- G8 proof wording
    proof = mods.get("proof") or {}
    if proof.get("included"):
        meta = proof.get("meta") or {}
        if meta.get("match_level") in (2, 3, 4) and meta.get("label_text"):
            if norm(meta["label_text"]) not in norm(page["text"]):
                r.err("G8", f"borrowed proof is not labeled on the page (expected \"{meta['label_text']}\")")
        client = meta.get("client_name")
        if client and meta.get("in_snapshot") is False:
            rank_words = re.compile(r"\b(top (three|3)|#\s?1|number one|ranks?|ranked|ranking|first on (the )?map|on top of the map)\b", re.I)
            for b in page["blocks"]:
                for sent in sentences(b.text):
                    if norm(client) in norm(sent) and rank_words.search(sent):
                        r.err("G8", f"proof client sits next to a rank claim, but it is not in the map read: \"{sent[:140]}\"")


def shingle_set(text: str, n: int) -> set[str]:
    w = words(text)
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}


def sibling_related(data: dict, sib: dict) -> bool:
    city = slug(data.get("city", ""))
    service = slug(data.get("service", ""))
    sd = sib.get("data") or {}
    scity = slug(sd.get("city", "")) or sib["meta"].get("city", "")
    sservice = slug(sd.get("service", "")) or sib["meta"].get("industry", "")
    if not scity and not sservice:
        p = sib["path"].lower()
        return bool(city and city in p) or bool(service and service in p)
    same_city = bool(city) and (scity == city or scity.startswith(city + "-"))
    same_service = bool(service) and (sservice == service)
    return same_city or same_service


def check_filler(page: dict, data: dict, cfg: dict, r: Report, is_hub: bool) -> None:
    allowed = [re.compile(a["pattern"], re.I) for a in data.get("allowed_filler") or [] if a.get("pattern")]
    text = page["text"]
    hits = 0
    for rule in cfg["banned_filler"]:
        sev = rule.get("hub_severity", rule["severity"]) if is_hub else rule["severity"]
        for m in re.finditer(rule["pattern"], text, re.I):
            ctx = text[max(0, m.start() - 50):m.end() + 50].replace("\n", " ")
            if any(a.search(m.group(0)) or a.search(ctx) for a in allowed):
                r.note("G5", f"allowed by page-data ({rule['group']}): '{m.group(0)}'")
                continue
            hits += 1
            (r.err if sev == "error" else r.warn)("G5", f"{rule['group']}: '{m.group(0)}' in ...{ctx.strip()}...")
    r.stats["filler_hits"] = hits
    # place lists, in prose and in bulleted lists
    maxn = cfg["place_list_max_items"]
    title_item = re.compile(r"^(?:[A-Z][\w'.-]*)(?: [A-Z][\w'.-]*){0,3}$")
    for b in page["blocks"]:
        if b.kind != "text":
            continue
        for sent in sentences(b.text):
            items = [i.strip(" .;:") for i in re.split(r",|\band\b|\bor\b", sent)]
            places = [i for i in items if title_item.match(i)]
            if len(places) > maxn:
                r.err("G5", f"place list with {len(places)} names (max {maxn} in one sentence): \"{sent[:120]}\"")
    by_list: dict[int, list[str]] = {}
    for b in page["blocks"]:
        if b.list_id is not None and b.kind == "text":
            by_list.setdefault(b.list_id, []).append(b.text.strip())
    for items in by_list.values():
        if len(items) > maxn and all(title_item.match(i.strip(" .")) for i in items):
            r.err("G5", f"bulleted list of {len(items)} place names; say coverage in one sentence instead")
    if cfg.get("embedded_map_is_filler"):
        for src in page["iframes"]:
            if "google.com/maps" in src or "maps.google" in src:
                r.err("G5", "embedded Google map in the main content; a map embed is not local content")


# ------------------------------------------------------------------ siblings
def load_siblings(d: Path, me: Path) -> list[dict]:
    out = []
    for p in sorted(d.rglob("*.html")):
        try:
            if p.resolve() == me.resolve():
                continue
        except OSError:
            continue
        s = read_page(p)
        sd = None
        for cand in (p.with_suffix(".data.json"), p.with_name(p.stem + ".page-data.json"), p.parent / "page-data.json"):
            if cand.exists():
                try:
                    sd = json.loads(cand.read_text(encoding="utf-8"))
                    break
                except json.JSONDecodeError:
                    pass
        s["data"] = sd
        out.append(s)
    return out


def deep_merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def run(args) -> tuple[int, dict]:
    cfg = json.loads(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    if args.config:
        cfg = deep_merge(cfg, json.loads(Path(args.config).read_text(encoding="utf-8")))
    data_path = Path(args.data)
    if not data_path.exists():
        raise UsageError(f"--data file not found: {data_path}")
    try:
        data = json.loads(data_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise UsageError(f"--data is not valid JSON: {e}")
    r = Report()
    check_data(data, cfg, r)
    check_build(data, cfg, r, plan_mode=args.plan)
    if not args.plan:
        if not args.file:
            raise UsageError("--file is required unless --plan is set")
        fp = Path(args.file)
        if not fp.exists():
            raise UsageError(f"--file not found: {fp}")
        page = read_page(fp)
        sibs = []
        if args.siblings:
            sd = Path(args.siblings)
            if not sd.is_dir():
                raise UsageError(f"--siblings must be a folder: {sd}")
            sibs = load_siblings(sd, fp)
        r.stats["siblings"] = len(sibs)
        check_page(page, data, cfg, sibs, r)
    result = {"page": args.file, "data": args.data, "mode": "plan" if args.plan else "page",
              "result": "fail" if r.errors else "pass", "errors": r.errors, "warnings": r.warnings,
              "notes": r.notes, "stats": r.stats}
    return (1 if r.errors else 0), result


def print_text(res: dict) -> None:
    print(f"local_gate {res['mode']}: {res['result'].upper()}  ({res['page'] or res['data']})")
    st = res["stats"]
    if "unique_total" in st:
        print(f"  data points: {st['unique_total']} unique, modules present: {', '.join(st['data_modules_present']) or 'none'}")
        print(f"  by module (found/unique): " + ", ".join(
            f"{k} {st['facts_found'].get(k, 0)}/{st['unique_data_points'].get(k, '-')}" for k in st["facts_found"]))
    if "swap_test" in st:
        sw = st["swap_test"]
        print(f"  city swap: {sw['data_sentences']} of {sw['sentences']} data-section sentences carry local data ({sw['share']:.0%})")
    if "similarity_max" in st:
        print(f"  closest sibling: {st['similarity_max']['jaccard']:.1%} ({st['similarity_max']['sibling']})")
    if "filler_hits" in st:
        print(f"  banned filler hits: {st['filler_hits']}")
    if "build_check" in st:
        print(f"  build check: {st['build_check']}")
    for label, items in (("FAIL", res["errors"]), ("WARN", res["warnings"]), ("note", res["notes"])):
        for it in items:
            print(f"  {label} [{it['gate']}] {it['msg']}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data", required=True, help="page-data.json")
    ap.add_argument("--file", help="rendered page HTML")
    ap.add_argument("--siblings", help="folder of sibling pages (HTML, optional <stem>.data.json beside each)")
    ap.add_argument("--config", help="site JSON that overrides config.json values")
    ap.add_argument("--plan", action="store_true", help="check the data and the build rules only (no page yet)")
    ap.add_argument("--json", action="store_true")
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    try:
        code, res = run(args)
    except UsageError as e:
        print(f"local_gate: {e}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(res, indent=2))
    else:
        print_text(res)
    return code


if __name__ == "__main__":
    sys.exit(main())
