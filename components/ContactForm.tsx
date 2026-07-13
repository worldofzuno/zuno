"use client";

import { FormEvent, useState } from "react";

export default function ContactForm() {
  const [status, setStatus] = useState<"idle" | "submitted">("idle");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitted");
  }

  if (status === "submitted") {
    return (
      <p role="status" className="text-sm text-gold">
        Thanks for reaching out — we&apos;ll get back to you soon.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="name" className="text-xs uppercase tracking-[0.25em] text-beige/50">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="name"
          className="mt-2 min-h-[44px] w-full rounded-lg border border-white/15 bg-transparent px-4 text-sm text-beige outline-none transition-colors focus:border-gold"
        />
      </div>

      <div>
        <label htmlFor="email" className="text-xs uppercase tracking-[0.25em] text-beige/50">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-2 min-h-[44px] w-full rounded-lg border border-white/15 bg-transparent px-4 text-sm text-beige outline-none transition-colors focus:border-gold"
        />
      </div>

      <div>
        <label htmlFor="message" className="text-xs uppercase tracking-[0.25em] text-beige/50">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          className="mt-2 w-full resize-none rounded-lg border border-white/15 bg-transparent px-4 py-3 text-sm text-beige outline-none transition-colors focus:border-gold"
        />
      </div>

      <button
        type="submit"
        className="min-h-[44px] w-full cursor-pointer rounded-full bg-gold px-6 text-sm font-medium text-black transition-transform duration-200 hover:bg-gold/90 active:scale-[0.98] sm:w-auto"
      >
        Send Message
      </button>
    </form>
  );
}
