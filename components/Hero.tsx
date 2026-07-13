"use client";

import { motion } from "framer-motion";
import { ButtonLink } from "./Button";

export default function Hero() {
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

      <div className="container-content relative py-32 text-center">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="font-display text-sm uppercase tracking-[0.4em] text-gold"
        >
          ZUNO
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="text-balance mx-auto mt-6 max-w-3xl font-display text-4xl leading-[1.1] text-beige sm:text-6xl lg:text-7xl"
        >
          Starting with Coffee.
          <br />
          <span className="text-gold">Not Stopping There.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-6 max-w-md text-balance text-base text-beige/60"
        >
          A modern Swiss lifestyle brand, built on quality, design and
          community. Today it&apos;s coffee. Tomorrow, who knows.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10"
        >
          <ButtonLink href="/shop">SHOP</ButtonLink>
        </motion.div>
      </div>

      <motion.div
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.8 }}
        className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 sm:flex"
      >
        <span className="text-[10px] uppercase tracking-[0.3em] text-beige/40">
          Scroll
        </span>
        <span className="h-10 w-px animate-pulse bg-gradient-to-b from-gold/60 to-transparent" />
      </motion.div>
    </section>
  );
}
