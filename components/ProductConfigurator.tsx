"use client";

import { useMemo, useState } from "react";
import { useCart } from "./CartContext";
import ProductVisual from "./ProductVisual";
import { Button } from "./Button";

type Size = "200g" | "500g";
type Grind = "Whole Beans" | "Pre-Ground";

const prices: Record<Size, number> = {
  "200g": 14.9,
  "500g": 29.9,
};

export default function ProductConfigurator() {
  const [size, setSize] = useState<Size>("200g");
  const [grind, setGrind] = useState<Grind>("Whole Beans");
  const [justAdded, setJustAdded] = useState(false);
  const { addItem } = useCart();

  const price = prices[size];

  const id = useMemo(() => `castano-${size}-${grind}`.toLowerCase().replace(/\s+/g, "-"), [
    size,
    grind,
  ]);

  function handleAddToCart() {
    addItem({ id, name: "Castano", size, grind, priceChf: price });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2000);
  }

  return (
    <div className="grid grid-cols-1 gap-16 lg:grid-cols-2">
      <ProductVisual size={size} className="mx-auto max-w-md" />

      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-gold">Castano</p>
        <h1 className="text-balance mt-4 font-display text-3xl leading-tight text-beige sm:text-4xl">
          Meet Castano — Because Ordinary Coffee is Just So&hellip; Ordinary
        </h1>

        <p className="mt-6 text-sm leading-relaxed text-beige/70">
          Looking for coffee that doesn&apos;t just wake you up but makes
          your taste buds write a thank-you letter? Meet Castano. It&apos;s
          not your average, everyday, run-of-the-mill brew — this is coffee
          with personality, and yes, it knows it&apos;s better than the
          rest.
        </p>

        <dl className="mt-8 space-y-5 border-t border-white/10 pt-8">
          <div>
            <dt className="text-xs uppercase tracking-[0.25em] text-gold">
              Flavor profile
            </dt>
            <dd className="mt-1 text-sm text-beige/60">
              Smooth elegance with nutty notes and just the right touch of
              sweetness.
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.25em] text-gold">
              Origin
            </dt>
            <dd className="mt-1 text-sm text-beige/60">
              Carefully sourced beans from Brazil, Indonesia, India and
              Honduras, roasted to perfection.
            </dd>
          </div>
        </dl>

        <div className="mt-10 border-t border-white/10 pt-8">
          <p className="font-display text-2xl text-gold">
            CHF {price.toFixed(2)}
          </p>

          <fieldset className="mt-6">
            <legend className="text-xs uppercase tracking-[0.25em] text-beige/50">
              Size
            </legend>
            <div className="mt-3 flex gap-3">
              {(["200g", "500g"] as Size[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  aria-pressed={size === s}
                  className={`min-h-[44px] cursor-pointer rounded-full border px-6 text-sm font-medium transition-[transform,background-color,border-color,color] duration-press ease-premium active:scale-[0.97] ${
                    size === s
                      ? "border-gold bg-gold text-black"
                      : "border-white/15 text-beige/80 hover:border-gold/50"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-6">
            <legend className="text-xs uppercase tracking-[0.25em] text-beige/50">
              Coffee Type
            </legend>
            <div className="mt-3 flex gap-3">
              {(["Whole Beans", "Pre-Ground"] as Grind[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrind(g)}
                  aria-pressed={grind === g}
                  className={`min-h-[44px] cursor-pointer rounded-full border px-6 text-sm font-medium transition-[transform,background-color,border-color,color] duration-press ease-premium active:scale-[0.97] ${
                    grind === g
                      ? "border-gold bg-gold text-black"
                      : "border-white/15 text-beige/80 hover:border-gold/50"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </fieldset>

          <Button
            onClick={handleAddToCart}
            aria-live="polite"
            className="mt-8 w-full sm:w-auto"
          >
            {/* Both labels share one grid cell, so the button never resizes and
                the swap is a pure crossfade rather than a layout jump. */}
            <span className="grid grid-cols-1 grid-rows-1 place-items-center">
              <span
                className={`col-start-1 row-start-1 transition-opacity duration-press ease-premium ${
                  justAdded ? "opacity-0" : "opacity-100"
                }`}
              >
                Add to Cart
              </span>
              <span
                aria-hidden={!justAdded}
                className={`col-start-1 row-start-1 transition-opacity duration-press ease-premium ${
                  justAdded ? "opacity-100" : "opacity-0"
                }`}
              >
                Added to Cart
              </span>
            </span>
          </Button>

          <p className="mt-4 text-xs text-beige/40">
            Free shipping on orders of CHF 45 or more. Delivery within
            Switzerland and Liechtenstein, 1–3 business days.
          </p>
        </div>
      </div>
    </div>
  );
}
