"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useCart } from "./CartContext";
import { IconAccount, IconCart, IconClose, IconMenu } from "./icons";

const links = [
  { href: "/shop", label: "Shop" },
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { count } = useCart();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-control ease-premium ${
        scrolled
          ? "border-white/5 bg-black/80 backdrop-blur-md"
          : "border-transparent bg-transparent"
      }`}
    >
      <nav className="container-content flex h-20 items-center justify-between">
        <Link
          href="/"
          className="font-display text-2xl tracking-[0.15em] text-gold"
          onClick={() => setOpen(false)}
        >
          ZUNO
        </Link>

        <ul className="hidden items-center gap-10 md:flex">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-sm font-medium tracking-wide text-beige/90 transition-colors duration-control hover:text-gold"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-5">
          <Link
            href="/account"
            aria-label="Account"
            className="hidden min-h-[44px] min-w-[44px] items-center justify-center text-beige/90 transition-colors duration-control hover:text-gold md:flex"
          >
            <IconAccount className="h-5 w-5" />
          </Link>
          <Link
            href="/cart"
            aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
            className="relative flex min-h-[44px] min-w-[44px] items-center justify-center text-beige/90 transition-colors duration-control hover:text-gold"
          >
            <IconCart className="h-5 w-5" />
            <AnimatePresence>
              {count > 0 && (
                <motion.span
                  key={count}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ type: "spring", duration: 0.35, bounce: 0.25 }}
                  className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[10px] font-semibold text-black"
                >
                  {count}
                </motion.span>
              )}
            </AnimatePresence>
          </Link>
          <button
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-beige/90 transition-colors duration-control hover:text-gold md:hidden"
          >
            {open ? <IconClose className="h-6 w-6" /> : <IconMenu className="h-6 w-6" />}
          </button>
        </div>
      </nav>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
            }}
            className="overflow-hidden border-t border-white/5 bg-black md:hidden"
          >
            <ul className="container-content flex flex-col gap-1 py-4">
              {[...links, { href: "/account", label: "Account" }].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-[44px] items-center text-base text-beige/90 transition-colors duration-control hover:text-gold"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
