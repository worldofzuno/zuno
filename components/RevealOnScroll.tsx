"use client";

import { motion } from "framer-motion";
import { itemVariants } from "./MotionSection";

/**
 * A block that fades up as part of its section's entrance.
 *
 * Inside a `MotionSection` the parent drives the timing, so these stagger in
 * sequence rather than each firing its own observer. `standalone` restores the
 * old self-triggering behaviour for the few places with no MotionSection above
 * them.
 */
export default function RevealOnScroll({
  children,
  delay = 0,
  className,
  y = 16,
  standalone = false,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  y?: number;
  standalone?: boolean;
}) {
  const common = {
    className: `decorative-motion ${className ?? ""}`,
    transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const },
  };

  if (standalone) {
    return (
      <motion.div
        {...common}
        initial={{ opacity: 0, y }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div className={common.className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}
