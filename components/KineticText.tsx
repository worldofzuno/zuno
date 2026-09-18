"use client";

import { motion, type Variants } from "framer-motion";
import type { ElementType } from "react";

/**
 * Text that rises into view a word at a time from behind a clipping edge.
 *
 * Split on words rather than characters: splitting mid-word breaks the
 * shaping of a display face like Felix Titling, and it turns one readable
 * string into dozens of nodes. The whole phrase stays available to assistive
 * technology through aria-label, and every piece of the split is hidden from
 * it, so the reveal is decoration rather than content.
 */

const line: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055 } },
};

const word: Variants = {
  hidden: { y: "110%" },
  show: {
    y: "0%",
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
};

export default function KineticText({
  text,
  as = "h2",
  className = "",
  once = true,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  once?: boolean;
}) {
  const Component = motion[as as "h2"] ?? motion.h2;
  const words = text.split(" ");

  return (
    <Component
      aria-label={text}
      variants={line}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount: 0.6 }}
      className={className}
    >
      {words.map((w, i) => (
        // The clipping box is what the word rises out of; it has to sit on its
        // own line box, hence inline-block on both the mask and the word.
        <span
          key={`${w}-${i}`}
          aria-hidden="true"
          className="inline-block overflow-hidden align-bottom"
          style={{ paddingBottom: "0.12em" }}
        >
          <motion.span variants={word} className="decorative-motion inline-block">
            {w}
          </motion.span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </Component>
  );
}
