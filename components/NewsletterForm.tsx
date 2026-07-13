"use client";

import { FormEvent, useState } from "react";

export default function NewsletterForm({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<"idle" | "submitted">("idle");
  const [email, setEmail] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("submitted");
  }

  if (status === "submitted") {
    return (
      <p
        role="status"
        className={`mt-4 text-sm text-gold ${compact ? "" : "text-center"}`}
      >
        You&apos;re in. Welcome to the world of ZUNO.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`mt-4 flex ${compact ? "flex-col gap-2" : "flex-col gap-3 sm:flex-row sm:gap-3"}`}
    >
      <label htmlFor="newsletter-email" className="sr-only">
        Email address
      </label>
      <input
        id="newsletter-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Your email address"
        className="min-h-[44px] flex-1 rounded-full border border-white/15 bg-transparent px-5 text-sm text-beige placeholder:text-beige/40 outline-none transition-colors focus:border-gold"
      />
      <button
        type="submit"
        className="min-h-[44px] cursor-pointer rounded-full bg-gold px-6 text-sm font-medium text-black transition-transform duration-200 hover:bg-gold/90 active:scale-[0.98]"
      >
        Join
      </button>
    </form>
  );
}
