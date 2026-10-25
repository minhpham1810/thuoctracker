"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icon";
import { api, type Medicine } from "@/lib/api";

// What the FDA labels (DailyMed, stored in Tiger by backend/labels.py) say about this patient's medicines.
// Two tabs. Interactions has no AI in it: quoted label sentences plus known pathways, sorted by the label section
// they come from (the label's own words decide how serious it looks, not a score we made up). Ask the labels is
// local Gemma answering only from numbered label passages, which are always shown under the answer.

type LabelSays = {
  label_of: string; names: string; matched: string; by: "name" | "class";
  section: string; section_title: string | null; sentence: string; label: string; version: number | null; url: string;
};
type Pathway = { mechanism: string; source: string; why: string };
type Pair = { drugs: [string, string]; label_says: LabelSays[]; pathways: Pathway[]; labels_checked: number };
type Check = { medicines: { name: string; drug: string; label: boolean }[]; pairs: Pair[]; loaded?: string[]; note: string };
type Source = { n: number; drug: string; label: string; section: string; version: number | null; text: string; url: string };
type Warning = { n: number; drug: string; section: string; sentence: string };
type Answer = { answer: string; warnings: Warning[]; searched: string[]; sources: Source[] };

// The label section a sentence came from, most serious first. Drugs.com and Medscape sort by severity; we sort by
// where the label itself put the statement, and say so on the badge.
type Tier = "boxed" | "contra" | "warning" | "listed" | "mechanism";
const TIER: Record<Tier, { badge: string; icon: IconName }> = {
  boxed: { badge: "Boxed warning", icon: "alert" },
  contra: { badge: "Contraindication", icon: "x" },
  warning: { badge: "Label warning", icon: "alert" },
  listed: { badge: "Listed interaction", icon: "pill" },
  mechanism: { badge: "Known mechanism", icon: "clock" },
};
const ORDER: Tier[] = ["boxed", "contra", "warning", "listed", "mechanism"];
const tierOf = (section: string): Tier =>
  section === "boxed_warning" ? "boxed" : section === "contraindications" ? "contra"
    : section === "drug_interactions" ? "listed" : "warning";
const pairTier = (p: Pair): Tier =>
  ORDER.find((t) => p.label_says.some((s) => tierOf(s.section) === t)) ?? "mechanism";
const SECTION: Record<string, string> = {
  boxed_warning: "Boxed warning", contraindications: "Contraindications", warnings_precautions: "Warnings and precautions",
  warnings: "Warnings", precautions: "Precautions", drug_interactions: "Drug interactions",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "5 WARNINGS AND PRECAUTIONS" -> "Warnings and precautions" (older labels shout their headings)
const heading = (s: string) => {
  const t = s.replace(/^\d+(\.\d+)*\s*/, "");
  return t === t.toUpperCase() ? cap(t.toLowerCase()) : t;
};
const TABS = [{ id: "check", label: "Interactions" }, { id: "ask", label: "Ask the labels" }] as const;

export default function DrugLabels({ patientId, meds }: { patientId: number; meds: Medicine[] }) {
  const [tab, setTab] = useState<"check" | "ask">("check");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // arrow keys move between the two tabs (WAI-ARIA tabs pattern)
  function onTabKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    tabs.current[next]?.focus();
  }

  return (
    <section className="block labels" aria-labelledby="labels-h">
      <div className="block-head">
        <h3 id="labels-h">Drug safety</h3>
        <p className="muted">From FDA prescribing labels on DailyMed</p>
      </div>
      <div className="labels-sheet">
        <div className="labels-tabs" role="tablist" aria-label="Drug safety tools">
          {TABS.map((t, i) => (
            <button key={t.id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`lt-${t.id}`}
              aria-selected={tab === t.id} aria-controls={`lp-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)} onKeyDown={(e) => onTabKey(e, i)}>
              {t.label}
            </button>
          ))}
        </div>
        {/* both stay mounted so a result survives switching tabs */}
        <div role="tabpanel" id="lp-check" aria-labelledby="lt-check" hidden={tab !== "check"}>
          <Interactions patientId={patientId} meds={meds} />
        </div>
        <div role="tabpanel" id="lp-ask" aria-labelledby="lt-ask" hidden={tab !== "ask"}>
          <AskLabels patientId={patientId} meds={meds} />
        </div>
      </div>
    </section>
  );
}

function Interactions({ patientId, meds }: { patientId: number; meds: Medicine[] }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState("");
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState(false);
  const names = meds.map((m) => m.name).join("|"); // reload when the medicines change, not on every poll

  const load = useCallback(async (add: string) => {
    setError("");
    setBusy(true);
    try {
      setCheck(await api<Check>(`/patients/${patientId}/interactions${add ? `?add=${encodeURIComponent(add)}` : ""}`));
      setAdded(add);
      if (add) setAdding(""); // it's a chip in the list now
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check the labels");
    }
    setBusy(false);
  }, [patientId]);

  useEffect(() => {
    const t = setTimeout(() => load(""), 0);
    return () => clearTimeout(t);
  }, [load, names]);

  const found = (check?.pairs.filter((p) => p.label_says.length || p.pathways.length) ?? [])
    .sort((a, b) => ORDER.indexOf(pairTier(a)) - ORDER.indexOf(pairTier(b)));
  const nothing = check?.pairs.filter((p) => !p.label_says.length && !p.pathways.length) ?? [];
  // the drug typed in: missing from the list when the patient already takes it (same drug, any name)
  const addedMed = added && !meds.some((m) => m.name === added) ? check?.medicines.find((m) => m.name === added) : undefined;
  const addedHits = addedMed ? found.filter((p) => p.drugs.includes(addedMed.drug)) : [];
  const counts = ORDER.map((t) => [t, found.filter((p) => pairTier(p) === t).length] as const).filter(([, n]) => n);
  const listed = check?.medicines ?? meds.map((m) => ({ name: m.name, drug: m.name.toLowerCase(), label: true }));

  function clear() {
    setAdding("");
    load("");
  }

  return (
    <div className="lt-body">
      {/* the list being checked: the patient's medicines, plus the drug being considered */}
      <ul className="druglist" aria-label="Medicines checked">
        {listed.map((m) => {
          const considered = m === addedMed;
          return (
            <li key={m.name} className={`drug-chip${considered ? " considered" : ""}`}>
              {considered && <span className="chip-tag">Considering</span>}
              <b>{considered ? cap(m.name) : m.name}</b>
              {!m.label && <span className="chip-tag dim" title="No FDA label loaded: only other labels and known mechanisms were checked">no label</span>}
              {considered && (
                <button type="button" className="chip-x" onClick={clear} aria-label={`Remove ${m.name}`}><Icon name="close" /></button>
              )}
            </li>
          );
        })}
      </ul>

      <form className="labels-add" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) load(adding.trim()); }}>
        <label className="sr" htmlFor={`add-${patientId}`}>Drug you&apos;re considering</label>
        <input id={`add-${patientId}`} list={`loaded-${patientId}`} value={adding} autoComplete="off"
          onChange={(e) => setAdding(e.target.value)} placeholder="Check a drug you're considering, e.g. clarithromycin" />
        <datalist id={`loaded-${patientId}`}>
          {check?.loaded?.map((d) => <option key={d} value={cap(d)} />)}
        </datalist>
        <button type="submit" className="btn btn-primary" disabled={busy || !adding.trim()}>
          {busy ? "Checking…" : "Check"}
        </button>
      </form>

      {error && <p className="form-error" role="alert">{error}</p>}
      {check && (
        <div aria-live="polite">
          <p className={`labels-summary${found.length ? " has" : ""}`} role="status">
            {added && !addedMed ? <><b>{cap(added)}</b> is already one of this patient&apos;s medicines.</>
              : addedMed && !addedHits.length ? (addedMed.label
                ? <>Nothing in the labels links <b>{cap(addedMed.drug)}</b> with this patient&apos;s medicines.</>
                : <>No FDA label for <b>&ldquo;{added}&rdquo;</b>, and the patient&apos;s labels don&apos;t mention it. Check the spelling or try the generic name (ibuprofen, not Advil).</>)
              : meds.length < 2 && !added ? <>Interactions need two or more medicines. Check a drug you&apos;re considering above.</>
              : found.length ? <><b>{plural(found.length, "combination")} to review</b>{counts.length > 0 && (
                  <span className="counts">
                    {counts.map(([t, n]) => <span key={t} className={`tier-count tier-${t}`}>{n} {TIER[t].badge.toLowerCase()}</span>)}
                  </span>)}</>
              : <>Nothing in the labels links these medicines with each other.</>}
          </p>

          {found.length > 0 && (
            <ul className="pairs">
              {found.map((p) => {
                const t = pairTier(p);
                return (
                  <li key={p.drugs.join("+")} className={`pair tier-${t}`}>
                    <div className="pair-head">
                      <h4>{p.drugs.map((d) => <span key={d} className={d === addedMed?.drug ? "considered" : undefined}>{cap(d)}</span>)}</h4>
                      <span className={`tier-badge tier-${t}`}><Icon name={TIER[t].icon} /> {TIER[t].badge}</span>
                    </div>
                    {p.label_says.map((s) => (
                      <figure key={s.label_of} className="quote">
                        <blockquote>{s.sentence}</blockquote>
                        <figcaption>
                          {cap(s.label_of)} label · {SECTION[s.section] ?? s.section_title}
                          {s.by === "class" && <> · names {s.names} by class (&ldquo;{s.matched}&rdquo;)</>}
                          {" · "}<a href={s.url} target="_blank" rel="noreferrer">DailyMed <Icon name="external" /><span className="sr"> (opens in a new tab)</span></a>
                        </figcaption>
                      </figure>
                    ))}
                    {p.pathways.map((w) => (
                      <p key={w.why} className="mechanism">
                        <span className="mech-name">{cap(w.mechanism)}</span>
                        <span>{w.why} <small>Source: {w.source}</small></span>
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}

          {nothing.length > 0 && found.length > 0 && (
            <p className="labels-none">
              <Icon name="check" /> Nothing found for {nothing.map((p) => p.drugs.map(cap).join(" + ")).join(", ")}.
            </p>
          )}
          <p className="labels-note">{check.note}</p>
        </div>
      )}
    </div>
  );
}

function AskLabels({ patientId, meds }: { patientId: number; meds: Medicine[] }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Answer | null>(null);
  const [asked, setAsked] = useState("");
  const [error, setError] = useState("");
  const grounded = !!result && /\[\d+\]/.test(result.answer);

  // starting points from this patient's own medicines; a blank box gives no idea what it can answer
  const [a, b] = meds.map((m) => m.name);
  const suggestions = [
    a && `What are the most common side effects of ${a}?`,
    a && `Does ${a} need a change when kidney function drops?`,
    b && `Can ${a} and ${b} be taken together?`,
    a && `What does the ${a} label say about older adults?`,
  ].filter((s): s is string => !!s);

  async function ask(q: string) {
    if (!q.trim()) return;
    setQuestion(q);
    setBusy(true);
    setError("");
    try {
      setResult(await api<Answer>("/ai/drugs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q.trim(), patient_id: patientId }),
      }));
      setAsked(q.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't ask the labels");
    }
    setBusy(false);
  }

  return (
    <div className="lt-body">
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
        <label className="sr" htmlFor={`ask-${patientId}`}>Question about this patient&apos;s medicines</label>
        <input id={`ask-${patientId}`} value={question} onChange={(e) => setQuestion(e.target.value)} disabled={busy}
          placeholder="Ask about side effects, interactions, kidney or liver use…" />
        <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>
          {busy ? "Reading labels…" : "Ask"}
        </button>
      </form>
      {!result && !busy && suggestions.length > 0 && (
        <div className="suggest">
          <span className="muted">Try:</span>
          {suggestions.map((s) => <button key={s} type="button" className="suggest-chip" onClick={() => ask(s)}>{s}</button>)}
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {busy && <p className="ask-wait" role="status"><span className="dots" aria-hidden="true" /> Searching the labels and writing an answer. This takes a few seconds.</p>}

      {result && !busy && (
        // a real answer always cites passages (the backend rejects one that doesn't): no [n] = no answer in the labels
        <div className="answer" aria-live="polite" key={asked}>
          <p className="answer-q">{asked}</p>
          {result.warnings.length > 0 && (
            <div className="label-warnings" role="note">
              <p className="lw-head"><Icon name="alert" /> The labels warn about using these together</p>
              {result.warnings.map((w) => (
                <figure key={w.n} className="quote">
                  <blockquote>{w.sentence}</blockquote>
                  <figcaption>{cap(w.drug)} label · {SECTION[w.section] ?? w.section} <a className="cite" href={`#src-${patientId}-${w.n}`} onClick={() => openSource(patientId, w.n)} aria-label={`source ${w.n}`}>{w.n}</a></figcaption>
                </figure>
              ))}
            </div>
          )}
          <div className={`ai-answer${grounded ? "" : " none"}`}>
            <p className="ai-tag">
              {grounded ? `AI summary of ${plural(result.sources.length, "label passage")}. Check the sources before acting.` : "No answer in the labels"}
            </p>
            <p className="answer-text">{cite(result.answer, patientId)}</p>
          </div>
          <details className="sources" open={!grounded}>
            <summary>
              Sources: {result.searched.length ? result.searched.map(cap).join(", ") : "all loaded"} {result.searched.length === 1 ? "label" : "labels"}
              <Icon name="chevron" className="icon chev" />
            </summary>
            <ol>
              {result.sources.map((s) => (
                <li key={s.n} id={`src-${patientId}-${s.n}`}>
                  <details>
                    <summary><span className="n">{s.n}</span> {cap(s.drug)} · {heading(s.section)}</summary>
                    <p className="passage">{s.text}</p>
                    <p className="small"><a href={s.url} target="_blank" rel="noreferrer">{s.label}<span className="sr"> (opens in a new tab)</span></a></p>
                  </details>
                </li>
              ))}
            </ol>
          </details>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setResult(null); setQuestion(""); }}>
            Ask another question
          </button>
        </div>
      )}
    </div>
  );
}

// a citation opens the source list and that passage, then the link scrolls to it
function openSource(patientId: number, n: string | number) {
  const li = document.getElementById(`src-${patientId}-${n}`);
  li?.closest<HTMLDetailsElement>("details.sources")?.setAttribute("open", "");
  li?.querySelector("details")?.setAttribute("open", "");
}

// "... [2][3]." -> links to the numbered passages
function cite(text: string, patientId: number) {
  return text.split(/(\[\d+\])/).map((part, i) => {
    const n = part.match(/^\[(\d+)\]$/)?.[1];
    return n
      ? <a key={i} className="cite" href={`#src-${patientId}-${n}`} onClick={() => openSource(patientId, n)} aria-label={`source ${n}`}>{n}</a>
      : part;
  });
}
