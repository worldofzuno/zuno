"use client";

import { useRef, type ReactNode } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

export type StickyCard = {
  eyebrow: string;
  title: string;
  body: string;
  aside?: ReactNode;
};

/**
 * Cards that pin under the header and stack, each one settling slightly
 * smaller as the next slides over it, so the pile reads as depth rather than
 * as a list that stopped scrolling.
 *
 * The scale is driven by the card's own scroll progress rather than a
 * duration: the user controls the timeline, and reversing the scroll has to
 * reverse the motion exactly.
 */
export default function StickyScrollCards({
  cards,
  className = "",
}: {
  cards: StickyCard[];
  className?: string;
}) {
  return (
    <div className={className}>
      {cards.map((card, i) => (
        <Card key={card.title} card={card} index={i} total={cards.length} />
      ))}
    </div>
  );
}

function Card({
  card,
  index,
  total,
}: {
  card: StickyCard;
  index: number;
  total: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // The ref sits on the outer track, not on the pinned card. A sticky element
  // stops moving the moment it pins, so measuring it would freeze progress at
  // zero; the track keeps scrolling and is what actually drives the timeline.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  // The last card never recedes — there is nothing arriving to cover it.
  const isLast = index === total - 1;
  const scale = useTransform(scrollYProgress, [0, 1], [1, isLast ? 1 : 0.9]);
  const dim = useTransform(scrollYProgress, [0, 1], [0, isLast ? 0 : 0.55]);

  return (
    <div
      ref={ref}
      style={{
        marginBottom: isLast ? 0 : "clamp(40px, 6vw, 90px)",
      }}
    >
    <div
      className="sticky"
      style={{
        // Each card pins a little lower than the one before, so the stacked
        // edges stay visible instead of hiding behind the top card.
        top: `calc(120px + ${index * 14}px)`,
      }}
    >
      <motion.article
        style={{ scale }}
        className="decorative-motion relative origin-top overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-green/45 via-black to-black p-8 sm:p-12"
      >
        <p className="text-xs uppercase tracking-[0.3em] text-gold">
          {card.eyebrow}
        </p>
        <h3 className="text-balance mt-4 font-display text-2xl leading-snug text-beige sm:text-3xl">
          {card.title}
        </h3>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-beige/65">
          {card.body}
        </p>
        {card.aside ? <div className="mt-8">{card.aside}</div> : null}

        {/* Darkens as the next card arrives, which is what sells the depth. */}
        <motion.div
          aria-hidden="true"
          style={{ opacity: dim }}
          className="pointer-events-none absolute inset-0 rounded-3xl bg-black"
        />
      </motion.article>
    </div>
    </div>
  );
}
