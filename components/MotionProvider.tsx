"use client";

import { MotionConfig } from "framer-motion";

/**
 * Applies the user's reduced-motion preference to every Motion animation on the
 * site. Motion strips transform and layout animations while keeping opacity and
 * colour, which is what reduced motion is meant to be: fewer and gentler, not
 * none.
 *
 * This has to happen here rather than per component: `useReducedMotion()`
 * returns null on the first render, so components that read it to build their
 * `initial` variant still render a positional offset and animate out of it
 * before the hook resolves.
 */
export default function MotionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
