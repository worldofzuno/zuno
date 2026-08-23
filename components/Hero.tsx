"use client";

import { motion, type Variants } from "framer-motion";
import { ButtonLink } from "./Button";

export default function Hero() {
  // 70ms stagger: close enough to read as one movement, wide enough to have
  // a direction. Longer than the 300ms UI budget on purpose — this is the
  // first paint of a marketing page, the one place the delight budget lives.
  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.07 } },
  };

  const item: Variants = {
    hidden: { opacity: 0, y: 18 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
    },
  };

  return (
    <section className="relative flex min-h-[92dvh] items-center overflow-hidden bg-black">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 20%, rgba(30,57,50,0.55) 0%, rgba(0,0,0,0) 60%), radial-gradient(ellipse 60% 50% at 85% 85%, rgba(248,217,155,0.08) 0%, rgba(0,0,0,0) 60%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="container-content relative py-32 text-center"
      >
        <motion.h1
          variants={item}
          className="decorative-motion text-balance mx-auto max-w-3xl font-display text-4xl leading-[1.1] text-beige sm:text-6xl lg:text-7xl"
        >
          Starting with Coffee
          <br />
          <span className="text-gold">Not Stopping There</span>
        </motion.h1>

        <motion.p
          variants={item}
          className="decorative-motion mx-auto mt-6 max-w-md text-balance text-base text-beige/60"
        >
          A modern Swiss lifestyle brand, built on quality, design and
          community. Today it&apos;s coffee. Tomorrow, who knows.
        </motion.p>

        <motion.div variants={item} className="decorative-motion mt-10">
          <ButtonLink href="/shop">Shop</ButtonLink>
        </motion.div>
      </motion.div>
    </section>
  );
}
