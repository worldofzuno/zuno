"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "./CartContext";
import { IconAccount, IconCart, IconClose, IconMenu } from "./icons";

const links = [
  { href: "/shop", label: "Shop" },
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const { count } = useCart();

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-black/80 backdrop-blur-md">
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
                className="text-sm font-medium tracking-wide text-beige/90 transition-colors duration-200 hover:text-gold"
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
            className="hidden min-h-[44px] min-w-[44px] items-center justify-center text-beige/90 transition-colors hover:text-gold md:flex"
          >
            <IconAccount className="h-5 w-5" />
          </Link>
          <Link
            href="/cart"
            aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
            className="relative flex min-h-[44px] min-w-[44px] items-center justify-center text-beige/90 transition-colors hover:text-gold"
          >
            <IconCart className="h-5 w-5" />
            {count > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[10px] font-semibold text-black">
                {count}
              </span>
            )}
          </Link>
          <button
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center text-beige/90 hover:text-gold md:hidden"
          >
            {open ? <IconClose className="h-6 w-6" /> : <IconMenu className="h-6 w-6" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-white/5 bg-black md:hidden">
          <ul className="container-content flex flex-col gap-1 py-4">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-[44px] items-center text-base text-beige/90 hover:text-gold"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/account"
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center text-base text-beige/90 hover:text-gold"
              >
                Account
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
