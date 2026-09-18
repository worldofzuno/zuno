"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";

export type DockItem = {
  label: string;
  href: string;
  icon: ReactNode;
};

const BASE = 44; // resting size, also the minimum touch target
const PEAK = 76; // size directly under the pointer
const REACH = 130; // how far the pull is felt, in px

/**
 * A dock whose items swell as the pointer approaches, the way the macOS dock
 * does. The magnification is driven by a spring rather than a duration
 * because it tracks a continuous input the user can reverse at any moment.
 *
 * On touch there is no pointer to track, so the effect is left off entirely
 * and the row renders at its resting size — which is why BASE is 44px.
 */
export default function MagneticDock({
  items,
  className = "",
}: {
  items: DockItem[];
  className?: string;
}) {
  // Infinity parks every item outside REACH, so nothing is magnified at rest.
  const pointerX = useMotionValue(Number.POSITIVE_INFINITY);

  return (
    <nav
      aria-label="Quick links"
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        pointerX.set(e.clientX);
      }}
      onPointerLeave={() => pointerX.set(Number.POSITIVE_INFINITY)}
      className={`mx-auto flex w-fit items-end gap-3 rounded-full border border-gold/20 bg-black/60 px-4 pb-3 pt-2 backdrop-blur-md ${className}`}
    >
      {items.map((item) => (
        <DockButton key={item.href} item={item} pointerX={pointerX} />
      ))}
    </nav>
  );
}

function DockButton({
  item,
  pointerX,
}: {
  item: DockItem;
  pointerX: MotionValue<number>;
}) {
  const ref = useRef<HTMLAnchorElement>(null);

  // Distance from the pointer to this item's centre, measured live so the
  // dock keeps working after a resize or a scroll.
  const distance = useTransform(pointerX, (x) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return Number.POSITIVE_INFINITY;
    return Math.abs(x - (box.left + box.width / 2));
  });

  const target = useTransform(distance, [0, REACH], [PEAK, BASE], {
    clamp: true,
  });
  const size = useSpring(target, { stiffness: 320, damping: 26, mass: 0.45 });

  return (
    <motion.a
      ref={ref}
      href={item.href}
      aria-label={item.label}
      style={{ width: size, height: size }}
      whileTap={{ scale: 0.92 }}
      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-beige/80 transition-colors duration-control hover:border-gold/40 hover:text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      <span className="flex h-5 w-5 items-center justify-center [&>svg]:h-full [&>svg]:w-full">
        {item.icon}
      </span>

      {/* Name appears above the item, the way a dock labels what you are on. */}
      <span className="pointer-events-none absolute -top-9 whitespace-nowrap rounded-full border border-gold/20 bg-black/90 px-3 py-1 text-[11px] tracking-wide text-gold opacity-0 transition-opacity duration-control group-hover:opacity-100 group-focus-visible:opacity-100">
        {item.label}
      </span>
    </motion.a>
  );
}

/** Link-flavoured variant for in-app routes. */
export function DockLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href}>{children}</Link>;
}
