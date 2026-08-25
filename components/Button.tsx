"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "ghost";

/* Scale is driven by whileHover/whileTap, so it is not in the CSS transition
   list any more — leaving `active:scale` in place would fight the tap gesture
   and compound the two scales. Colour still transitions in CSS, which keeps it
   working even if the motion runtime never loads. */
const base =
  "inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-sm font-medium tracking-wide cursor-pointer min-h-[44px] transition-[background-color,border-color,color] duration-press ease-premium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

const variants: Record<Variant, string> = {
  primary: "bg-gold text-black hover:bg-gold/90",
  outline: "border border-gold/40 text-gold hover:border-gold hover:bg-gold/5",
  ghost: "text-beige hover:text-gold",
};

/* Buttons are pressed many times a day, so the feedback stays near the low end
   of the useful range: a 2% lift and a 3% press, both short. MotionConfig
   (reducedMotion="user") drops both for anyone who asks for reduced motion. */
const gestures = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.97 },
  transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] as const },
};

const MotionLink = motion.create(Link);

export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <MotionLink
      href={href}
      className={`${base} ${variants[variant]} ${className}`}
      {...gestures}
    >
      {children}
    </MotionLink>
  );
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <motion.button
      className={`${base} ${variants[variant]} ${className}`}
      {...gestures}
      {...(props as Record<string, unknown>)}
    >
      {children}
    </motion.button>
  );
}
