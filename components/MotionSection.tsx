"use client";

import { motion, type Variants } from "framer-motion";
import type { ElementType, ReactNode } from "react";

/**
 * A page section that fades up as it scrolls into view, and staggers whatever
 * `RevealOnScroll` children it contains.
 *
 * The section owns the trigger: children inherit the `show` state through
 * variants instead of each running their own viewport observer, so the whole
 * block reads as one movement rather than several overlapping ones.
 */

export const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
};

/** Applied by children of a MotionSection; the parent drives the timing. */
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
};

export default function MotionSection({
  as = "section",
  className,
  children,
  amount = 0.15,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
  /** Fraction of the section that must be visible before it animates. */
  amount?: number;
  [key: string]: unknown;
}) {
  const Component = motion[as as "section"] ?? motion.section;

  return (
    <Component
      className={`decorative-motion ${className ?? ""}`}
      variants={sectionVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      {...rest}
    >
      {children}
    </Component>
  );
}
