"use client";
/**
 * Cinematic motion, kept light for low-end phones: elements marked data-reveal fade and rise into
 * view once, in a short stagger. Nothing moves for people who ask for reduced motion.
 */
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function Reveal() {
  const path = usePathname();
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]:not(.in)")];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    document.documentElement.classList.add("motion");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        const siblings = el.parentElement ? [...el.parentElement.children].filter((c) => c.hasAttribute("data-reveal")) : [];
        el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 6) * 70}ms`;
        el.classList.add("in");
        io.unobserve(el);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    els.forEach((el) => io.observe(el));
    // Screens that load their content later (menus, order lists) add elements after this ran.
    const mo = new MutationObserver(() => {
      document.querySelectorAll<HTMLElement>("[data-reveal]:not(.in):not([data-watched])").forEach((el) => { el.dataset.watched = "1"; io.observe(el); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    els.forEach((el) => { el.dataset.watched = "1"; });
    return () => { io.disconnect(); mo.disconnect(); };
  }, [path]);
  return null;
}
