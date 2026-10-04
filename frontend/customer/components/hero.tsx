"use client";
/** Cinematic hero: full-bleed slides that cross-fade with a slow push-in, auto-advancing; pauses on hover and focus. */
import { useEffect, useRef, useState } from "react";
import { useLocationCtx } from "./location";

export function HeroCarousel({ slides, labels }: { slides: React.ReactNode[]; labels: string[] }) {
  const [i, setI] = useState(0);
  const paused = useRef(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => { if (!paused.current && !document.hidden) setI((n) => (n + 1) % slides.length); }, 7000);
    return () => clearInterval(t);
  }, [slides.length]);
  return (
    <div
      className="carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Tunakula"
      onMouseEnter={() => { paused.current = true; }}
      onMouseLeave={() => { paused.current = false; }}
      onFocus={() => { paused.current = true; }}
      onBlur={() => { paused.current = false; }}
    >
      {slides.map((s, k) => (
        <div key={k} className={`slide ${k === i ? "on" : ""}`} aria-hidden={k !== i} role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${slides.length}: ${labels[k]}`} {...(k !== i ? { inert: true } : {})}>
          {s}
        </div>
      ))}
      <div className="dots" role="tablist" aria-label="Choose a slide">
        {slides.map((_, k) => (
          <button key={k} type="button" role="tab" aria-selected={k === i} aria-label={labels[k]} className={k === i ? "on" : ""} onClick={() => setI(k)}>
            <span style={k === i ? { animationPlayState: "running" } : undefined} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Opens the location picker, then brings the nearby list into view. */
export function NearMeButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const { setPickerOpen } = useLocationCtx();
  return (
    <button type="button" className={className} onClick={() => { setPickerOpen(true); document.getElementById("near")?.scrollIntoView({ behavior: "smooth" }); }}>
      {children}
    </button>
  );
}

/** "Showing distances from Gombe · change". */
export function PlaceLine() {
  const { place, setPickerOpen } = useLocationCtx();
  return (
    <p className="place-line">
      Distances and times from <b>{place?.label ?? "…"}</b>
      {place?.source === "commune" ? " (commune centre)" : ""} · <button type="button" className="link-btn" onClick={() => setPickerOpen(true)}>change</button>
    </p>
  );
}
