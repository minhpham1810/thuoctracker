"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icon";

// Theme and text size for the dashboard, kept in this browser. Text size sets --fs, which every font size in
// doctor.css multiplies by. (Not CSS zoom: Chromium painted the zoomed page blank once scrolled down.)
export type Theme = "light" | "dark" | "system";
export type TextSize = "default" | "large" | "larger";
const THEMES: { v: Theme; label: string; icon: IconName }[] = [
  { v: "light", label: "Light", icon: "sun" },
  { v: "dark", label: "Dark", icon: "moon" },
  { v: "system", label: "System", icon: "monitor" },
];
const SIZES: { v: TextSize; label: string; scale: number }[] = [
  { v: "default", label: "Default", scale: 1 },
  { v: "large", label: "Large", scale: 1.125 },
  { v: "larger", label: "Larger", scale: 1.25 },
];
const KEY = "thuoc-doctor-display";

export type Display = ReturnType<typeof useDisplay>;

export function useDisplay() {
  const [theme, setTheme] = useState<Theme>("light");
  const [size, setSize] = useState<TextSize>("default");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => setSystemDark(mq.matches);
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
        if (THEMES.some((x) => x.v === saved.theme)) setTheme(saved.theme);
        if (SIZES.some((x) => x.v === saved.size)) setSize(saved.size);
      } catch {
        // storage blocked or bad JSON: defaults
      }
      follow();
    }, 0);
    mq.addEventListener("change", follow);
    return () => { clearTimeout(t); mq.removeEventListener("change", follow); };
  }, []);

  const save = useCallback((next: { theme: Theme; size: TextSize }) => {
    setTheme(next.theme);
    setSize(next.size);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* lasts until reload */ }
  }, []);

  const scale = SIZES.find((x) => x.v === size)?.scale ?? 1;
  return {
    theme, size, scale,
    dark: theme === "dark" || (theme === "system" && systemDark),
    setTheme: (t: Theme) => save({ theme: t, size }),
    setSize: (s: TextSize) => save({ theme, size: s }),
  };
}

// The "Display" button in the app bar and its little panel. Escape or a click outside closes it.
export function DisplayMenu({ display }: { display: Display }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("keydown", onKey);
    addEventListener("mousedown", onDown);
    return () => { removeEventListener("keydown", onKey); removeEventListener("mousedown", onDown); };
  }, [open]);

  return (
    <div className="display" ref={root}>
      <button ref={trigger} type="button" className="btn btn-quiet btn-sm" aria-expanded={open} aria-controls="display-panel"
        onClick={() => setOpen((o) => !o)}>
        <Icon name="sliders" /> Display
      </button>
      {open && (
        <div className="display-panel" id="display-panel" role="dialog" aria-label="Display">
          <fieldset>
            <legend>Theme</legend>
            <div className="seg">
              {THEMES.map((t) => (
                <button key={t.v} type="button" aria-pressed={display.theme === t.v} onClick={() => display.setTheme(t.v)}>
                  <Icon name={t.icon} /> {t.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Text size</legend>
            <div className="seg">
              {SIZES.map((s) => (
                <button key={s.v} type="button" aria-pressed={display.size === s.v} onClick={() => display.setSize(s.v)}>
                  <span className="aa" style={{ fontSize: `${14 * s.scale}px` }} aria-hidden="true">Aa</span> {s.label}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="display-note">Saved in this browser.</p>
        </div>
      )}
    </div>
  );
}
