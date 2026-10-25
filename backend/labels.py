"""FDA prescribing labels for the doctor: what a drug's label says about interactions and side effects.

Labels come from DailyMed as SPL XML, one row per top-level section (boxed warning, contraindications,
warnings and precautions, adverse reactions, drug interactions, ...). Clinical sections are cut into
~800-character chunks that never cross a section boundary, embedded with MiniLM (Ollama `all-minilm`,
384 dims) and indexed both as a vector (pgvector / pgvectorscale on Tiger) and as a tsvector. A search
ranks both ways in one SQL statement and fuses the two lists with Reciprocal Rank Fusion, so an exact
term ("rhabdomyolysis") and a paraphrase ("muscle breakdown") both find their passage. Without the
embedding model it falls back to keyword search only.

The interaction check has no language model in it: for each pair of a patient's medicines it reads the
sections where labels state interactions and quotes the sentence where one label names the other (by
name, brand or class), plus known pathways (CYP enzymes, P-gp, additive effects) from FDA's table of
substrates, inhibitors and inducers and CredibleMeds. It informs the doctor; it never changes a dose.

    python -m backend.labels ingest              # fetch + parse + embed the curated list (~2 min, once per database)
    python -m backend.labels ingest warfarin     # just these
    python -m backend.labels search "muscle pain" atorvastatin
    python -m backend.labels check warfarin aspirin atorvastatin clarithromycin
"""
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from itertools import combinations

import requests

from .db import pool, q

DAILYMED = "https://dailymed.nlm.nih.gov/dailymed/services/v2"
CACHE = os.path.join(os.path.dirname(__file__), "..", "data", "dailymed")  # downloaded XML, gitignored
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "all-minilm")  # all-MiniLM-L6-v2, 384 dims
DIMS = 384
MAX_CHARS = 800  # MiniLM reads ~256 word pieces and drops the rest
RRF_K = 60
COMMON = 0.15  # a word in more than this share of all chunks says nothing about which chunk to pick

# drug -> (DailyMed search, labeler the title must name, title must contain, title must not contain, class words).
# The labeler / form filters pick the maker's own label over repackagers and combination products. Class words
# are how other labels name the drug's group in an interaction statement ("NSAIDs", "CYP3A4 inhibitors", ...).
CURATED = {
    "atorvastatin": ("LIPITOR", "VIATRIS", None, None, ["statin", "HMG-CoA reductase inhibitor"]),
    "simvastatin": ("ZOCOR", "ORGANON", None, None, ["statin", "HMG-CoA reductase inhibitor"]),
    "rosuvastatin": ("CRESTOR", "ASTRAZENECA", None, None, ["statin", "HMG-CoA reductase inhibitor"]),
    "pravastatin": ("PRAVASTATIN SODIUM", None, None, None, ["statin", "HMG-CoA reductase inhibitor"]),
    "metformin": ("METFORMIN HYDROCHLORIDE", None, None, None, ["biguanide", "antidiabetic", "hypoglycemic agent"]),
    "insulin glargine": ("LANTUS", "SANOFI", None, None, ["insulin", "antidiabetic", "hypoglycemic agent"]),
    "sitagliptin": ("JANUVIA", "MERCK", None, None, ["DPP-4 inhibitor", "antidiabetic", "hypoglycemic agent"]),
    "semaglutide": ("OZEMPIC", "NOVO NORDISK", "INJECTION", None, ["GLP-1 receptor agonist", "antidiabetic"]),
    "aspirin": ("DURLAZA", None, None, None, ["antiplatelet", "NSAID", "salicylate"]),
    "clopidogrel": ("PLAVIX", "SANOFI", None, None, ["antiplatelet", "P2Y12 inhibitor"]),
    "warfarin": ("WARFARIN SODIUM", None, "TABLET", None, ["anticoagulant", "vitamin K antagonist"]),
    "apixaban": ("ELIQUIS", "SQUIBB", None, None, ["anticoagulant"]),
    "rivaroxaban": ("XARELTO", "JANSSEN", None, None, ["anticoagulant"]),
    "amlodipine": ("NORVASC", None, None, None, ["calcium channel blocker", "antihypertensive"]),
    "diltiazem": ("DILTIAZEM HYDROCHLORIDE", None, "CAPSULE", None, ["calcium channel blocker", "antihypertensive"]),
    "lisinopril": ("LISINOPRIL", None, "TABLET", "HYDROCHLOROTHIAZIDE", ["ACE inhibitor", "antihypertensive"]),
    "losartan": ("LOSARTAN POTASSIUM", None, "TABLET", "HYDROCHLOROTHIAZIDE",
                 ["angiotensin receptor blocker", "ARB", "antihypertensive"]),
    "metoprolol": ("METOPROLOL TARTRATE", None, "TABLET", "HYDROCHLOROTHIAZIDE",
                   ["beta-blocker", "beta blocker", "antihypertensive"]),
    "spironolactone": ("SPIRONOLACTONE", None, "TABLET", "HYDROCHLOROTHIAZIDE", ["potassium-sparing diuretic", "diuretic"]),
    "furosemide": ("FUROSEMIDE", None, "TABLET", None, ["loop diuretic", "diuretic"]),
    "digoxin": ("DIGOXIN", None, "TABLET", None, ["digitalis glycoside", "cardiac glycoside"]),
    "amiodarone": ("AMIODARONE HYDROCHLORIDE", None, "TABLET", None, ["antiarrhythmic"]),
    "sertraline": ("SERTRALINE HYDROCHLORIDE", None, "TABLET", None,
                   ["SSRI", "selective serotonin reuptake inhibitor", "antidepressant"]),
    "citalopram": ("CITALOPRAM", None, "TABLET", None, ["SSRI", "selective serotonin reuptake inhibitor", "antidepressant"]),
    "fluoxetine": ("FLUOXETINE", None, "CAPSULE", "OLANZAPINE",
                   ["SSRI", "selective serotonin reuptake inhibitor", "antidepressant"]),
    "tramadol": ("TRAMADOL HYDROCHLORIDE", None, "TABLET", "ACETAMINOPHEN", ["opioid", "CNS depressant"]),
    "oxycodone": ("OXYCODONE HYDROCHLORIDE", None, "TABLET", "ACETAMINOPHEN", ["opioid", "CNS depressant"]),
    "gabapentin": ("GABAPENTIN", None, "CAPSULE", None, ["CNS depressant"]),
    "quetiapine": ("SEROQUEL", "ASTRAZENECA", None, "XR", ["antipsychotic", "CNS depressant"]),
    "alprazolam": ("ALPRAZOLAM", None, "TABLET", None, ["benzodiazepine", "CNS depressant"]),
    "omeprazole": ("OMEPRAZOLE", None, "CAPSULE, DELAYED RELEASE", "SODIUM BICARBONATE", ["proton pump inhibitor", "PPI"]),
    "levothyroxine": ("SYNTHROID", "ABBVIE", None, None, ["thyroid hormone"]),
    "prednisone": ("PREDNISONE", None, None, None, ["corticosteroid"]),
    "clarithromycin": ("CLARITHROMYCIN", None, "TABLET", None, ["macrolide"]),
    "azithromycin": ("ZITHROMAX", "PFIZER", None, None, ["macrolide"]),
    "ciprofloxacin": ("CIPROFLOXACIN", None, "TABLET", "OTIC", ["fluoroquinolone", "quinolone"]),
    "amoxicillin": ("AMOXICILLIN", None, "CAPSULE", "CLAVULANATE", ["penicillin"]),
    "fluconazole": ("DIFLUCAN", None, None, None, ["azole antifungal"]),
}
# common drugs with no label loaded (OTC monographs use another layout): still matched by name and class
# when another drug's label talks about them
UNLOADED = {"ibuprofen": ["NSAID"], "naproxen": ["NSAID"], "acetaminophen": [], "ketoconazole": ["azole antifungal"],
            "itraconazole": ["azole antifungal"], "erythromycin": ["macrolide"], "rifampin": [], "verapamil":
            ["calcium channel blocker"], "potassium chloride": ["potassium supplement"], "grapefruit": []}

# LOINC section code -> key. Anything else is 'other', kept but not embedded.
SECTION_KEYS = {
    "34066-1": "boxed_warning", "43683-2": "recent_major_changes", "34067-9": "indications",
    "34068-7": "dosage_administration", "43678-2": "dosage_forms", "34070-3": "contraindications",
    "43685-7": "warnings_precautions", "34071-1": "warnings", "42232-9": "precautions",
    "34084-4": "adverse_reactions", "34073-7": "drug_interactions", "43684-0": "specific_populations",
    "34088-5": "overdosage", "34089-3": "description", "34090-1": "clinical_pharmacology",
    "43680-8": "nonclinical_toxicology", "34092-7": "clinical_studies", "34069-5": "how_supplied",
    "34076-0": "patient_information", "42231-1": "medguide", "59845-8": "instructions_for_use",
}
SKIP_CODES = {"48780-1", "51945-4"}  # structured product data and carton images: not prose
# the sections worth searching; patient leaflets restate them in plainer words and would only add duplicates
EMBED_SECTIONS = {"boxed_warning", "indications", "contraindications", "warnings_precautions", "warnings",
                  "precautions", "adverse_reactions", "drug_interactions", "specific_populations", "overdosage",
                  "clinical_pharmacology", "dosage_administration"}
# where labels state interactions and restrictions, most serious first
MENTION_SECTIONS = ["boxed_warning", "contraindications", "warnings_precautions", "warnings", "precautions",
                    "drug_interactions"]

SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS drug_labels (
  id serial PRIMARY KEY,
  drug text NOT NULL UNIQUE,              -- generic, lowercase: 'atorvastatin'
  names text[] NOT NULL,                  -- what a medicine may be called: generic + brand
  classes text[] NOT NULL DEFAULT '{{}}',   -- how other labels name its group: 'statin', 'NSAID'
  setid text NOT NULL,                    -- DailyMed set id, stable across versions
  title text NOT NULL,
  version int,
  effective date,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS label_sections (
  id serial PRIMARY KEY,
  label_id int NOT NULL REFERENCES drug_labels(id) ON DELETE CASCADE,
  position int NOT NULL,
  section text NOT NULL,                  -- key from SECTION_KEYS, e.g. 'drug_interactions'
  title text,
  content text NOT NULL
);
CREATE INDEX IF NOT EXISTS label_sections_label ON label_sections (label_id, section);
CREATE TABLE IF NOT EXISTS label_chunks (
  id bigserial PRIMARY KEY,
  section_id int NOT NULL REFERENCES label_sections(id) ON DELETE CASCADE,
  label_id int NOT NULL,
  section text NOT NULL,
  content text NOT NULL,
  embedding vector({DIMS}),               -- null if the embedding model wasn't there at ingest
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX IF NOT EXISTS label_chunks_tsv ON label_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS label_chunks_label ON label_chunks (label_id, section);
-- how many chunks each word occurs in, across every label: a question's common words ("take", "patient", "dose")
-- would match half of any label, so keyword search keeps only the rare ones. Rebuilt after each ingest.
CREATE TABLE IF NOT EXISTS label_lexemes (word text PRIMARY KEY, ndoc int NOT NULL);
"""
# pgvectorscale's StreamingDiskANN index where Tiger has it, plain HNSW otherwise
VECTOR_INDEX = [
    "CREATE EXTENSION IF NOT EXISTS vectorscale CASCADE;"
    " CREATE INDEX IF NOT EXISTS label_chunks_vec ON label_chunks USING diskann (embedding vector_cosine_ops)",
    "CREATE INDEX IF NOT EXISTS label_chunks_vec ON label_chunks USING hnsw (embedding vector_cosine_ops)",
]


def ensure_schema():
    q(SCHEMA)
    for sql in VECTOR_INDEX:
        try:
            q(sql)
            return
        except Exception as e:
            print(f"[labels] vector index: {e!r}")


# --- DailyMed -> XML on disk ------------------------------------------------------------------------
def fetch(drug: str) -> tuple[str, str]:
    """Resolve a curated drug to its newest DailyMed label and download it (cached). Returns (XML path, title)."""
    search, labeler, match, exclude, _ = CURATED[drug]
    r = requests.get(f"{DAILYMED}/spls.json", params={"drug_name": search, "pagesize": 100}, timeout=30)
    r.raise_for_status()
    found = []
    for d in r.json().get("data", []):
        t = d["title"].upper()
        if (labeler and labeler not in t) or (match and match not in t) or (exclude and exclude in t):
            continue
        found.append(d)
    # a title starting with the search term is the product itself; one merely containing it is usually a combination
    own = [d for d in found if d["title"].upper().startswith(search)]
    found = own or found
    if not found:
        raise LookupError(f"no DailyMed label for {search!r}")
    pick = max(found, key=lambda d: datetime.strptime(d["published_date"], "%b %d, %Y"))
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{pick['setid']}.xml")
    if not os.path.exists(path):
        x = requests.get(f"{DAILYMED}/spls/{pick['setid']}.xml", timeout=60)
        x.raise_for_status()
        with open(path, "wb") as f:
            f.write(x.content)
        time.sleep(0.3)  # a shared public service: be polite
    return path, pick["title"]


# --- SPL XML -> sections -----------------------------------------------------------------------------
BLOCK = {"paragraph", "title", "item", "tr", "table", "caption", "list", "section"}
CELL = {"td", "th"}
# 'excerpt' is the highlights summary repeated inside each section: dropped so nothing is indexed twice
DROP = {"code", "id", "effectiveTime", "renderMultiMedia", "observationMedia", "templateId", "author", "subject",
        "excerpt"}


def _tag(el) -> str:
    return el.tag.rsplit("}", 1)[-1] if isinstance(el.tag, str) else ""


def _kid(el, name):
    return next((c for c in el if _tag(c) == name), None)


def _flat(el, out: list):
    if el.text:
        out.append(el.text)
    for c in el:
        t = _tag(c)
        if t and t not in DROP:
            if t in BLOCK:
                out.append("\n")
            _flat(c, out)
            if t in CELL:
                out.append(" | ")
            if t in BLOCK or t == "br":
                out.append("\n")
        if c.tail:
            out.append(c.tail)


def text_of(el) -> str:
    if el is None:
        return ""
    out = []
    _flat(el, out)
    s = re.sub(r"[ \t\xa0]+", " ", "".join(out))
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return re.sub(r"•\n+", "• ", s).strip()  # a bullet glyph on its own line joins its item


def parse_spl(path: str) -> tuple[dict, list[dict]]:
    doc = ET.parse(path).getroot()
    meta = {"setid": (_kid(doc, "setId").attrib.get("root") if _kid(doc, "setId") is not None else None),
            "version": int(_kid(doc, "versionNumber").attrib.get("value", 0) or 0) or None,
            "effective": _kid(doc, "effectiveTime").attrib.get("value"),
            "title": re.sub(r"\s+", " ", text_of(_kid(doc, "title")))}
    body = _kid(_kid(doc, "component"), "structuredBody")
    sections = []
    for comp in body:
        sec = _kid(comp, "section")
        if sec is None:
            continue
        code = _kid(sec, "code")
        code = code.attrib if code is not None else {}
        if code.get("code") in SKIP_CODES:
            continue
        content = text_of(sec)
        if content:
            title = re.sub(r"\s+", " ", text_of(_kid(sec, "title"))) or code.get("displayName")
            sections.append({"section": SECTION_KEYS.get(code.get("code"), "other"), "title": title, "content": content})
    return meta, sections


# --- sections -> chunks -> vectors -------------------------------------------------------------------
def chunk(text: str) -> list[str]:
    """Whole paragraphs packed up to MAX_CHARS; a longer paragraph splits on sentences, a longer sentence is cut."""
    out, cur = [], ""
    for p in (p.strip() for p in re.split(r"\n\s*\n", text)):
        if not p:
            continue
        for piece in ([p] if len(p) <= MAX_CHARS else _split_long(p)):
            if cur and len(cur) + 1 + len(piece) <= MAX_CHARS:
                cur += "\n" + piece
            else:
                if cur:
                    out.append(cur)
                cur = piece
    if cur:
        out.append(cur)
    return out


def _split_long(text: str) -> list[str]:
    out, cur = [], ""
    for s in re.split(r"(?<=[.!?;])\s+", text):
        if len(s) > MAX_CHARS:
            if cur:
                out.append(cur)
                cur = ""
            out += [s[i:i + MAX_CHARS] for i in range(0, len(s), MAX_CHARS)]
        elif cur and len(cur) + 1 + len(s) <= MAX_CHARS:
            cur += " " + s
        else:
            if cur:
                out.append(cur)
            cur = s
    return out + ([cur] if cur else [])


def embed(texts: list[str]) -> list[list[float]] | None:
    """MiniLM vectors from the local Ollama, or None if it isn't running / the model isn't pulled."""
    try:
        out = []
        for i in range(0, len(texts), 64):
            r = requests.post(f"{OLLAMA_URL}/api/embed", json={"model": EMBED_MODEL, "input": texts[i:i + 64]},
                              timeout=120)
            r.raise_for_status()
            out += r.json()["embeddings"]
        return out
    except Exception as e:
        print(f"[labels] no embeddings ({EMBED_MODEL} on {OLLAMA_URL}): {e!r}; keyword search only")
        return None


def _vec(v) -> str | None:
    return None if v is None else "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def ingest(drug: str) -> str:
    path, title = fetch(drug)
    meta, sections = parse_spl(path)
    meta["title"] = title  # the XML's own title is the highlights boilerplate
    search, _, _, _, classes = CURATED[drug]
    names = [drug] + ([search.lower()] if drug not in search.lower() else [])
    eff = datetime.strptime(meta["effective"][:8], "%Y%m%d").date() if meta["effective"] else None
    with pool.connection() as c, c.transaction():
        label_id = c.execute(
            "INSERT INTO drug_labels (drug, names, classes, setid, title, version, effective) VALUES (%s, %s, %s, %s, %s, %s, %s)"
            " ON CONFLICT (drug) DO UPDATE SET names = EXCLUDED.names, classes = EXCLUDED.classes, setid = EXCLUDED.setid,"
            " title = EXCLUDED.title, version = EXCLUDED.version, effective = EXCLUDED.effective, fetched_at = now()"
            " RETURNING id", (drug, names, classes, meta["setid"], meta["title"], meta["version"], eff)).fetchone()["id"]
        c.execute("DELETE FROM label_sections WHERE label_id = %s", (label_id,))  # chunks go with them
        rows = []
        for i, s in enumerate(sections):
            sid = c.execute("INSERT INTO label_sections (label_id, position, section, title, content)"
                            " VALUES (%s, %s, %s, %s, %s) RETURNING id",
                            (label_id, i, s["section"], s["title"], s["content"])).fetchone()["id"]
            if s["section"] in EMBED_SECTIONS:
                rows += [(sid, label_id, s["section"], t) for t in chunk(s["content"])]
        vecs = embed([r[3] for r in rows]) or [None] * len(rows)
        with c.cursor() as cur:
            cur.executemany("INSERT INTO label_chunks (section_id, label_id, section, content, embedding)"
                            " VALUES (%s, %s, %s, %s, %s::vector)", [r + (_vec(v),) for r, v in zip(rows, vecs)])
    have = {s["section"] for s in sections}
    lacks = [k for k in ("contraindications", "adverse_reactions", "drug_interactions") if k not in have]
    return (f"{drug:18} v{meta['version'] or '?':<3} {len(sections):3} sections {len(rows):4} chunks"
            f"  {meta['title'][:60]}" + (f"   no {', '.join(lacks)}" if lacks else ""))


# --- search -----------------------------------------------------------------------------------------
def all_labels() -> list[dict]:
    return q("SELECT id, drug, names, classes, title, setid, version, effective FROM drug_labels ORDER BY drug")


def _says(name: str, alias: str) -> bool:
    return re.search(rf"\b{re.escape(alias)}\b", name, re.I) is not None


def labels_named(text: str, labels: list[dict] | None = None) -> list[dict]:
    """Labels for the drugs a medicine name or a question names ('Metformin 500 mg', 'Lipitor', ...)."""
    return [l for l in (labels if labels is not None else all_labels()) if any(_says(text, n) for n in l["names"])]


def search(query: str, label_ids: list[int] | None = None, k: int = 6, per_list: int = 50) -> list[dict]:
    """Hybrid search over label chunks: vector and keyword ranks fused with RRF. Scoped to label_ids if given."""
    v = embed([query])
    words = q("SELECT w.word, coalesce(x.ndoc, 0) AS ndoc, (SELECT count(*) FROM label_chunks) AS total"
              " FROM unnest(tsvector_to_array(to_tsvector('english', %s))) AS w(word)"
              " LEFT JOIN label_lexemes x ON x.word = w.word", query)
    rare = [w["word"] for w in words if w["ndoc"] <= COMMON * w["total"]] or [w["word"] for w in words]
    sql = """
    WITH vec AS (
      SELECT id, row_number() OVER (ORDER BY embedding <=> %(v)s::vector) AS rank
      FROM label_chunks
      WHERE %(v)s::vector IS NOT NULL AND embedding IS NOT NULL
        AND (%(ids)s::int[] IS NULL OR label_id = ANY(%(ids)s))
      ORDER BY embedding <=> %(v)s::vector LIMIT %(n)s
    ), kw_scored AS (
      -- any rare word of the question, not all of them: a doctor asks in sentences. Already stemmed: 'simple'
      SELECT id, ts_rank_cd(tsv, tq) AS score
      FROM label_chunks, to_tsquery('simple', %(tq)s) AS tq
      WHERE tsv @@ tq AND (%(ids)s::int[] IS NULL OR label_id = ANY(%(ids)s))
    ), kw AS (
      SELECT id, row_number() OVER (ORDER BY score DESC) AS rank FROM kw_scored ORDER BY score DESC LIMIT %(n)s
    ), fused AS (
      SELECT coalesce(vec.id, kw.id) AS id,
             coalesce(1.0 / (%(rrf)s + vec.rank), 0) + coalesce(1.0 / (%(rrf)s + kw.rank), 0) AS score
      FROM vec FULL OUTER JOIN kw ON kw.id = vec.id
    )
    SELECT c.id, l.drug, l.title AS label, l.setid, l.version, l.effective, c.section, s.title AS section_title,
           c.content, round(f.score::numeric, 4) AS score
    FROM fused f JOIN label_chunks c ON c.id = f.id
    JOIN label_sections s ON s.id = c.section_id JOIN drug_labels l ON l.id = c.label_id
    ORDER BY f.score DESC, c.id LIMIT %(k)s"""
    with pool.connection() as c:
        return c.execute(sql, {"v": _vec(v[0]) if v else None,
                               "tq": " | ".join("'" + w.replace("'", "''") + "'" for w in rare), "ids": label_ids, "n": per_list,
                               "rrf": RRF_K, "k": k}).fetchall()


def search_labels(question: str, labels: list[dict], k: int = 8) -> list[dict]:
    """Search each label on its own, with its own drug names taken out of the question (they match every chunk of
    it, while another drug's name in it is exactly what to look for), then merge so every drug gets a say."""
    if not labels:
        return search(question, None, k)
    each = max(2, k // len(labels))
    hits = []
    for l in labels:
        own = re.compile(r"\b(" + "|".join(map(re.escape, l["names"])) + r")\b", re.I)
        hits += search(own.sub(" ", question), [l["id"]], each)
    return sorted(hits, key=lambda r: -r["score"])[:max(k, 2 * len(labels))]


def passages_for(question: str, labels: list[dict]) -> list[dict]:
    """What to give the model for a question: when it names a drug, first the sentences where these labels name
    that drug (from check(): a search for "give her clarithromycin" in clarithromycin's own label finds its
    indications, not its warning about the patient's metformin), then the search hits. Those first ones are
    marked "interaction": the small model can skip them, so the route also shows them on their own."""
    named = {l["drug"] for l in labels_named(question, labels)}
    said = []
    if named and len(labels) > 1:
        for pair in check([l["drug"] for l in labels])["pairs"]:
            if named & set(pair["drugs"]):
                said += [{"id": None, "drug": s["label_of"], "label": s["label"], "setid": s["setid"],
                          "version": s["version"], "effective": s["effective"], "section": s["section"],
                          "section_title": s["section_title"], "content": s["sentence"], "score": None,
                          "interaction": True}
                         for s in pair["label_says"]]
    return said[:4] + search_labels(question, labels)


# --- interaction check (no model) ---------------------------------------------------------------------
# Known pathways, hand-seeded from FDA's "Drug Development and Drug Interactions: Table of Substrates, Inhibitors
# and Inducers", CredibleMeds QT categories and standard pharmacodynamic classes. (drug, role, mechanism, strength)
FDA_CYP, CREDIBLEMEDS, PD = "FDA table of CYP substrates, inhibitors and inducers", "CredibleMeds QT list", "pharmacodynamic class"
PATHWAYS = [(d, role, mech, strength, src) for mech, role, strength, src, drugs in [
    ("CYP3A4", "inhibits", "strong", FDA_CYP, "clarithromycin, itraconazole, ketoconazole"),
    ("CYP3A4", "inhibits", "moderate", FDA_CYP, "erythromycin, fluconazole, diltiazem, verapamil, grapefruit"),
    ("CYP3A4", "inhibits", "weak", FDA_CYP, "amlodipine"),
    ("CYP3A4", "induces", "strong", FDA_CYP, "rifampin"),
    ("CYP3A4", "substrate", "sensitive", FDA_CYP, "simvastatin, quetiapine"),
    ("CYP3A4", "substrate", "moderately sensitive", FDA_CYP, "atorvastatin, apixaban, rivaroxaban, oxycodone, alprazolam"),
    ("CYP2C9", "inhibits", "moderate", FDA_CYP, "fluconazole, amiodarone"),
    ("CYP2C9", "induces", "moderate", FDA_CYP, "rifampin"),
    ("CYP2C9", "substrate", "narrow therapeutic index", FDA_CYP, "warfarin"),
    ("CYP2C19", "inhibits", "strong", FDA_CYP, "fluconazole"),
    ("CYP2C19", "inhibits", "moderate", FDA_CYP, "omeprazole"),
    ("CYP2C19", "substrate", "moderately sensitive", FDA_CYP, "clopidogrel, citalopram"),
    ("CYP2D6", "inhibits", "strong", FDA_CYP, "fluoxetine"),
    ("CYP2D6", "substrate", "moderately sensitive", FDA_CYP, "metoprolol, tramadol, oxycodone"),
    ("P-gp", "inhibits", "moderate", FDA_CYP, "verapamil, amiodarone, clarithromycin, itraconazole, ketoconazole"),
    ("P-gp", "induces", "moderate", FDA_CYP, "rifampin"),
    ("P-gp", "substrate", "narrow therapeutic index", FDA_CYP, "digoxin"),
    ("QT prolongation", "adds", "strong", CREDIBLEMEDS, "amiodarone"),
    ("QT prolongation", "adds", "moderate", CREDIBLEMEDS, "citalopram, clarithromycin, erythromycin, fluconazole, ciprofloxacin"),
    ("QT prolongation", "adds", "weak", CREDIBLEMEDS, "azithromycin, quetiapine"),
    ("serotonergic activity", "adds", "moderate", PD, "fluoxetine, citalopram, sertraline, tramadol"),
    ("bleeding", "adds", "strong", PD, "warfarin, apixaban, rivaroxaban, clopidogrel"),
    ("bleeding", "adds", "moderate", PD, "aspirin, ibuprofen, naproxen"),
    ("bleeding", "adds", "weak", PD, "fluoxetine, citalopram, sertraline"),
    ("high potassium", "adds", "strong", PD, "spironolactone, potassium chloride"),
    ("high potassium", "adds", "moderate", PD, "lisinopril, losartan"),
    ("CNS depression", "adds", "strong", PD, "oxycodone, alprazolam"),
    ("CNS depression", "adds", "moderate", PD, "tramadol, gabapentin, quetiapine"),
    ("low blood sugar", "adds", "moderate", PD, "insulin glargine"),
    ("myopathy", "adds", "moderate", PD, "simvastatin, atorvastatin, rosuvastatin, pravastatin"),
] for d in drugs.split(", ")]
PRODRUGS = {("clopidogrel", "CYP2C19"): "clopidogrel needs CYP2C19 to become active: less active drug, less platelet inhibition",
            ("tramadol", "CYP2D6"): "tramadol needs CYP2D6 for its active metabolite: less pain relief"}


def pathways(a: str, b: str) -> list[dict]:
    """Known mechanisms linking two drugs, either direction."""
    out = []
    for x, y in ((a, b), (b, a)):
        for d1, role, mech, s1, src in PATHWAYS:
            if d1 != x or role not in ("inhibits", "induces"):
                continue
            for d2, role2, mech2, s2, _ in PATHWAYS:
                if d2 == y and role2 == "substrate" and mech2 == mech:
                    if (y, mech) in PRODRUGS:
                        effect = PRODRUGS[(y, mech)] if role == "inhibits" else f"more active {y}"
                    else:
                        effect = f"{y} levels may {'rise' if role == 'inhibits' else 'fall'}"
                    out.append({"mechanism": mech, "source": src,
                                "why": f"{x} {role} {mech} ({s1}); {y} is cleared by it ({s2}): {effect}."})
    for d1, role, mech, s1, src in PATHWAYS:
        if d1 == a and role == "adds":
            s2 = next((s for d, r, m, s, _ in PATHWAYS if d == b and r == "adds" and m == mech), None)
            if s2:
                out.append({"mechanism": mech, "source": src,
                            "why": f"Both add to {mech} ({a} {s1}, {b} {s2})."})
    return out


SALTS = r"\s+(hydrochloride|hcl|sodium|potassium|calcium|tartrate|succinate|besylate|maleate|hyclate)\b"


def _drug_of(name: str, labels: list[dict]) -> tuple[str, dict | None]:
    """A medicine name -> (generic, its label or None)."""
    hit = labels_named(name, labels)
    if hit:
        return hit[0]["drug"], hit[0]
    low = name.lower()
    for d in list(UNLOADED) + list(CURATED):
        if _says(low, d):
            return d, None
    return re.sub(SALTS, "", re.sub(r"\s+\d.*$", "", low)).strip(), None  # 'Foo 10 mg' -> 'foo'


def _terms(drug: str, label: dict | None) -> tuple[list[str], list[str]]:
    if label:
        return label["names"], label["classes"]
    return [drug], UNLOADED.get(drug) or (CURATED[drug][4] if drug in CURATED else [])


def _mention(a: dict, b_drug: str, b_label: dict | None, docs: list[dict]) -> dict | None:
    """The first sentence in a's interaction sections naming b (by name, brand or class), most serious section first."""
    names, classes = _terms(b_drug, b_label)
    same_class = set(c.lower() for c in classes) & set(c.lower() for c in a["classes"])  # "statins" in a statin label
    by_name = re.compile(r"\b(" + "|".join(map(re.escape, names)) + r")\b", re.I)
    by_class = (re.compile(r"\b(" + "|".join(map(re.escape, classes)) + r")s?\b", re.I)
                if classes and not same_class else None)
    for d in sorted((d for d in docs if d["label_id"] == a["id"]), key=lambda d: MENTION_SECTIONS.index(d["section"])):
        parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+|\n+", d["content"]) if p.strip()]
        hits = [(i, p, m) for i, p in enumerate(parts) if (m := by_name.search(p) or (by_class and by_class.search(p)))]
        if not hits:
            continue

        def heading(p):  # "7.3 Warfarin" or a table cell: quote the sentence under it
            return len(p) < 40 or (re.match(r"^\d+(\.\d+)*\s", p) and len(p) < 90)
        i, p, m = next((h for h in hits if not heading(h[1])), hits[0])
        if heading(p) and i + 1 < len(parts):
            p = f"{p}: {parts[i + 1]}"
        elif not re.search(r"[.!?:]$", p):  # a table cell ("aspirin, cilostazol, ..."): say which table
            caption = next((x for x in reversed(parts[:i]) if re.match(r"Table \d+", x)), None)
            if caption:
                p = f"{caption.rstrip('.')}: … {p}"
        return {"label_of": a["drug"], "names": b_drug, "matched": m.group(0), "by": "name" if by_name.search(p) else "class",
                "section": d["section"], "section_title": d["title"], "sentence": p if len(p) <= 400 else p[:397] + "…",
                "label": a["title"], "setid": a["setid"], "version": a["version"], "effective": a["effective"]}
    return None


def check(medicines: list[str]) -> dict:
    """Every pair of medicines: what each label says about the other, and known pathways. No model involved."""
    labels = all_labels()
    meds = []
    for name in medicines:
        drug, label = _drug_of(name, labels)
        if not any(m["drug"] == drug for m in meds):
            meds.append({"name": name, "drug": drug, "label": label})
    with_labels = [m["label"] for m in meds if m["label"]]
    docs = q("SELECT label_id, section, title, content FROM label_sections WHERE label_id = ANY(%s) AND section = ANY(%s)",
             [l["id"] for l in with_labels], MENTION_SECTIONS) if with_labels else []
    pairs = []
    for x, y in combinations(meds, 2):
        said = [s for a, b in ((x, y), (y, x)) if a["label"] and (s := _mention(a["label"], b["drug"], b["label"], docs))]
        known = pathways(x["drug"], y["drug"])
        checked = sum(1 for m in (x, y) if m["label"])
        if said or known or checked:
            pairs.append({"drugs": [x["drug"], y["drug"]], "label_says": said, "pathways": known,
                          "labels_checked": checked})
    rank = {s: i for i, s in enumerate(MENTION_SECTIONS)}
    # label text in a boxed warning or contraindication first, then other label text, then pathways only, then nothing
    pairs.sort(key=lambda p: (min((rank[s["section"]] for s in p["label_says"]), default=50 if p["pathways"] else 99),
                              p["drugs"]))
    return {"medicines": [{"name": m["name"], "drug": m["drug"], "label": bool(m["label"])} for m in meds],
            "pairs": pairs,
            "note": "From the FDA labels loaded and known pathways. A pair with nothing found means the loaded labels "
                    "don't name each other, not that the combination is safe. The doctor decides; nothing here changes a dose."}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ("", [])
    if cmd == "ingest":
        ensure_schema()
        for drug in args or CURATED:
            try:
                print(" ", ingest(drug))
            except Exception as e:
                print(f"  {drug:18} FAILED: {e!r}")
        with pool.connection() as c, c.transaction():
            c.execute("DELETE FROM label_lexemes")
            c.execute("INSERT INTO label_lexemes SELECT word, ndoc FROM ts_stat('SELECT tsv FROM label_chunks')")
        print(q("SELECT count(*) AS labels, (SELECT count(*) FROM label_chunks) AS chunks,"
                " (SELECT count(*) FROM label_chunks WHERE embedding IS NULL) AS without_vectors FROM drug_labels")[0])
    elif cmd == "search":
        for r in search_labels(args[0], [l for d in args[1:] for l in labels_named(d)]):
            print(f"\n[{r['score']}] {r['drug']} · {r['section_title']}\n{r['content'][:400]}")
    elif cmd == "check":
        import json
        print(json.dumps(check(args), indent=1, default=str))
    else:
        print(__doc__)
    pool.close()
