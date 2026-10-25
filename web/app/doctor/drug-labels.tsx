"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { api, type Medicine } from "@/lib/api";

// What the FDA labels (DailyMed, stored in Tiger by backend/labels.py) say about this patient's medicines.
// The pair list has no AI in it: quoted label sentences plus known pathways. "Ask the labels" is local Gemma
// answering only from numbered label passages, which are always shown under the answer.

type LabelSays = {
  label_of: string; names: string; matched: string; by: "name" | "class";
  section: string; section_title: string | null; sentence: string; label: string; version: number | null; url: string;
};
type Pathway = { mechanism: string; source: string; why: string };
type Pair = { drugs: [string, string]; label_says: LabelSays[]; pathways: Pathway[]; labels_checked: number };
type Check = { medicines: { name: string; drug: string; label: boolean }[]; pairs: Pair[]; note: string };
type Source = { n: number; drug: string; label: string; section: string; version: number | null; text: string; url: string };
type Warning = { n: number; drug: string; section: string; sentence: string };
type Answer = { answer: string; warnings: Warning[]; searched: string[]; sources: Source[] };

const SECTION: Record<string, string> = {
  boxed_warning: "Boxed warning", contraindications: "Contraindications", warnings_precautions: "Warnings and precautions",
  warnings: "Warnings", precautions: "Precautions", drug_interactions: "Drug interactions",
};
const tone = (p: Pair) =>
  p.label_says.some((s) => s.section === "boxed_warning" || s.section === "contraindications") ? "bad"
    : p.label_says.length ? "warn" : p.pathways.length ? "info" : "none";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// "5 WARNINGS AND PRECAUTIONS" -> "Warnings and precautions" (older labels shout their headings)
const heading = (s: string) => {
  const t = s.replace(/^\d+(\.\d+)*\s*/, "");
  return t === t.toUpperCase() ? cap(t.toLowerCase()) : t;
};

export default function DrugLabels({ patientId, meds }: { patientId: number; meds: Medicine[] }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [checkError, setCheckError] = useState("");
  const [adding, setAdding] = useState("");
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState(false);
  const names = meds.map((m) => m.name).join("|"); // reload when the medicines change, not on every poll

  const load = useCallback(async (add: string) => {
    setCheckError("");
    setBusy(true);
    try {
      setCheck(await api<Check>(`/patients/${patientId}/interactions${add ? `?add=${encodeURIComponent(add)}` : ""}`));
      setAdded(add);
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "Couldn't check the labels");
    }
    setBusy(false);
  }, [patientId]);

  useEffect(() => {
    const t = setTimeout(() => load(""), 0);
    return () => clearTimeout(t);
  }, [load, names]);

  const found = check?.pairs.filter((p) => p.label_says.length || p.pathways.length) ?? [];
  const nothing = check?.pairs.filter((p) => !p.label_says.length && !p.pathways.length) ?? [];
  // the drug typed in "Check": missing from the list when it's one the patient already takes (same drug, any name)
  const addedMed = added && !meds.some((m) => m.name === added) ? check?.medicines.find((m) => m.name === added) : undefined;
  const addedHits = addedMed ? found.filter((p) => p.drugs.includes(addedMed.drug)) : [];
  const others = meds.map((m) => m.name).join(meds.length > 2 ? ", " : " or ");
  const noLabel = check?.medicines.filter((m) => !m.label && m !== addedMed) ?? [];

  return (
    <section className="block labels" aria-labelledby="labels-h">
      <div className="block-head">
        <h3 id="labels-h">Interactions and side effects</h3>
        <p className="muted">From FDA prescribing labels (DailyMed)</p>
      </div>

      <form className="labels-add" onSubmit={(e) => { e.preventDefault(); load(adding.trim()); }}>
        <label className="field">
          <span>Check a drug you&apos;re considering <small>against this patient&apos;s medicines</small></span>
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="e.g. clarithromycin" />
        </label>
        <button type="submit" className="btn" disabled={busy || !adding.trim()}>{busy ? "Checking…" : "Check"}</button>
        {added && (
          <button type="button" className="btn btn-quiet" onClick={() => { setAdding(""); load(""); }}>
            <Icon name="close" /> Clear
          </button>
        )}
      </form>

      {checkError && <p className="form-error" role="alert">{checkError}</p>}
      {check && (
        <div aria-live="polite">
          {added && (
            <p className={`labels-result${addedHits.length ? " hit" : ""}`} role="status">
              {!addedMed ? <><b>{cap(added)}</b> is already one of this patient&apos;s medicines.</>
                : addedHits.length ? <>Found <b>{addedHits.length}</b> {addedHits.length === 1 ? "thing" : "things"} to know about <b>{cap(addedMed.drug)}</b> with {others}, below.</>
                : addedMed.label ? <>Nothing found between <b>{cap(addedMed.drug)}</b> and {others}: their FDA labels don&apos;t name each other and there&apos;s no known pathway. That is not proof the combination is safe.</>
                : <>No FDA label is loaded for <b>&ldquo;{added}&rdquo;</b>, and the labels of {others} don&apos;t mention it. Check the spelling, or try the generic name (ibuprofen, not Advil).</>}
            </p>
          )}
          {meds.length < 2 && !added ? (
            <p className="empty">Interactions need at least two medicines. Add one, or check a drug you&apos;re considering.</p>
          ) : found.length ? (
            <ul className="pairs">
              {found.map((p) => (
                <li key={p.drugs.join("+")} className={`pair tone-${tone(p)}`}>
                  <h4>
                    {p.drugs.map((d) => <span key={d} className={d === addedMed?.drug ? "considered" : undefined}>{cap(d)}</span>)}
                  </h4>
                  {p.label_says.map((s) => (
                    <blockquote key={s.label_of}>
                      <p>&ldquo;{s.sentence}&rdquo;</p>
                      <footer>
                        {cap(s.label_of)} label, {SECTION[s.section] ?? s.section_title}
                        {s.by === "class" && <> (names {s.names} by its class: &ldquo;{s.matched}&rdquo;)</>}
                        {" · "}<a href={s.url} target="_blank" rel="noreferrer">DailyMed<span className="sr"> (opens in a new tab)</span></a>
                      </footer>
                    </blockquote>
                  ))}
                  {p.pathways.map((w) => (
                    <p key={w.why} className="pathway"><b>{w.mechanism}:</b> {w.why} <small>{w.source}</small></p>
                  ))}
                </li>
              ))}
            </ul>
          ) : !added && (
            <p className="empty">The loaded labels don&apos;t name any of these medicines together.</p>
          )}
          {nothing.length > 0 && found.length > 0 && (
            <p className="muted small">Nothing found between {nothing.map((p) => p.drugs.map(cap).join(" + ")).join(", ")}.</p>
          )}
          {noLabel.length > 0 && (
            <p className="muted small">No FDA label loaded for {noLabel.map((m) => m.name).join(", ")}: only other labels and known pathways were checked.</p>
          )}
          <p className="muted small">{check.note}</p>
        </div>
      )}

      <AskLabels patientId={patientId} />
    </section>
  );
}

function AskLabels({ patientId }: { patientId: number }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState("");

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    try {
      setResult(await api<Answer>("/ai/drugs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), patient_id: patientId }),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't ask the labels");
    }
    setBusy(false);
  }

  return (
    <div className="ask-labels">
      <form onSubmit={ask}>
        <label className="field">
          <span>Ask the labels <small>about this patient&apos;s medicines, or any drug you name</small></span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={busy}
            placeholder="e.g. Does metformin need a change when kidney function drops?" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !question.trim()}>
          {busy ? "Reading labels…" : "Ask"}
        </button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {result && (
        <div className="answer" aria-live="polite">
          {result.warnings.length > 0 && (
            <div className="label-warnings" role="note">
              <p><Icon name="alert" /> <b>The labels warn about using these together</b></p>
              {result.warnings.map((w) => (
                <p key={w.n}>
                  &ldquo;{w.sentence}&rdquo; <small>{cap(w.drug)} label, {SECTION[w.section] ?? w.section}</small>
                  <a className="cite" href={`#src-${patientId}-${w.n}`} aria-label={`source ${w.n}`}>{w.n}</a>
                </p>
              ))}
            </div>
          )}
          <p className="answer-text">{cite(result.answer, patientId)}</p>
          <p className="muted small">
            Searched the {result.searched.length ? result.searched.map(cap).join(", ") : "all loaded"} label{result.searched.length === 1 ? "" : "s"}.
            {" "}Written by a local AI from the passages below: check them before acting.
          </p>
          <ol className="sources">
            {result.sources.map((s) => (
              <li key={s.n} id={`src-${patientId}-${s.n}`}>
                <details>
                  <summary><span className="n">{s.n}</span> {cap(s.drug)}, {heading(s.section)}</summary>
                  <p className="passage">{s.text}</p>
                  <p className="small"><a href={s.url} target="_blank" rel="noreferrer">{s.label}<span className="sr"> (opens in a new tab)</span></a></p>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// "... [2][3]." -> links to the numbered passages
function cite(text: string, patientId: number) {
  return text.split(/(\[\d+\])/).map((part, i) => {
    const n = part.match(/^\[(\d+)\]$/)?.[1];
    return n ? <a key={i} className="cite" href={`#src-${patientId}-${n}`} aria-label={`source ${n}`}>{n}</a> : part;
  });
}
