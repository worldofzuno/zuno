"use client";

import { useEffect, useRef } from "react";

/**
 * The Vanta CELLS field, fixed behind the whole app.
 *
 * `color1` is pure black, so `screen` blending drops every black pixel to
 * nothing and only the dark-green veins survive — the layer tints the page
 * rather than covering it. Sections are transparent for the same reason: an
 * opaque background would paint straight over a z-index:-1 layer.
 *
 * three.js is 601 KB for pure decoration, so fetching it is a decision
 * rather than a default. No WebGL, a metered connection or a small-memory
 * device and the bytes are never requested; the page is a flat black ground
 * in that case, which is what it was before this existed.
 */

type VantaEffect = {
  req?: number;
  animationLoop: () => void;
  destroy: () => void;
};

declare global {
  interface Window {
    VANTA?: { CELLS?: (opts: Record<string, unknown>) => VantaEffect };
  }
}

function load(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded) resolve();
      else existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = false; // three has to finish before vanta runs
    s.addEventListener("load", () => {
      s.dataset.loaded = "1";
      resolve();
    });
    s.addEventListener("error", () => reject(new Error(src)));
    document.head.appendChild(s);
  });
}

function affordable() {
  if (typeof window === "undefined") return false;

  const net = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
      deviceMemory?: number;
    }
  ).connection;
  if (net?.saveData) return false;
  if (/(^|-)2g$/.test(net?.effectiveType ?? "")) return false;

  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (mem && mem < 4) return false;

  // Probe before downloading: without WebGL the library would arrive only for
  // Vanta to throw during init.
  try {
    const probe = document.createElement("canvas");
    if (!(probe.getContext("webgl") || probe.getContext("experimental-webgl")))
      return false;
  } catch {
    return false;
  }
  return true;
}

export default function VantaBackground() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !affordable()) return;

    let fx: VantaEffect | null = null;
    let cancelled = false;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const halt = () => {
      if (fx?.req) window.cancelAnimationFrame(fx.req);
    };
    const resume = () => {
      if (fx && !document.hidden && !still.matches) fx.animationLoop();
    };
    const onVisibility = () => (document.hidden ? halt() : resume());
    const onMotionChange = () => (still.matches ? halt() : resume());

    // After paint, so the library never competes with the fonts or the hero.
    const timer = window.setTimeout(() => {
      load("/js/three.r134.min.js")
        .then(() => load("/js/vanta.cells.0.5.24.min.js"))
        .then(() => {
          if (cancelled || !window.VANTA?.CELLS) return;

          fx = window.VANTA.CELLS({
            el,
            mouseControls: true,
            touchControls: true,
            gyroControls: false,
            minHeight: 200.0,
            minWidth: 200.0,
            scale: 1.0,
            color1: 0x0,
            color2: 0x15290d,
            size: 5.0,
            speed: 0.0,
          });
          el.dataset.ready = "1";

          // Vanta runs a full-screen fragment shader at 60fps and never stops
          // on its own. Stop it whenever it cannot be seen, and stop it for
          // good for anyone who asked for less motion — they keep the
          // texture, frozen on the frame it reached.
          document.addEventListener("visibilitychange", onVisibility);
          still.addEventListener("change", onMotionChange);
          if (still.matches) window.setTimeout(halt, 400);
        })
        .catch(() => {
          /* decorative — the flat ground behind it is the fallback */
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      still.removeEventListener("change", onMotionChange);
      fx?.destroy();
    };
  }, []);

  return <div id="vanta-bg" ref={host} aria-hidden="true" />;
}
