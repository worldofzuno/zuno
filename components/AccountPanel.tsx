"use client";

import { FormEvent, useState } from "react";
import { Button } from "./Button";

export default function AccountPanel() {
  const [tab, setTab] = useState<"login" | "signup">("login");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="flex justify-center gap-2 rounded-full border border-white/10 p-1">
        {(["login", "signup"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`min-h-[44px] flex-1 cursor-pointer rounded-full text-sm font-medium transition-colors duration-200 ${
              tab === t
                ? "bg-gold text-black"
                : "text-beige/60 hover:text-beige"
            }`}
          >
            {t === "login" ? "Log In" : "Create Account"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {tab === "signup" && (
          <div>
            <label htmlFor="fullName" className="text-xs uppercase tracking-[0.25em] text-beige/50">
              Full Name
            </label>
            <input
              id="fullName"
              type="text"
              required
              autoComplete="name"
              className="mt-2 min-h-[44px] w-full rounded-lg border border-white/15 bg-transparent px-4 text-sm text-beige outline-none transition-colors focus:border-gold"
            />
          </div>
        )}
        <div>
          <label htmlFor="acc-email" className="text-xs uppercase tracking-[0.25em] text-beige/50">
            Email
          </label>
          <input
            id="acc-email"
            type="email"
            required
            autoComplete="email"
            className="mt-2 min-h-[44px] w-full rounded-lg border border-white/15 bg-transparent px-4 text-sm text-beige outline-none transition-colors focus:border-gold"
          />
        </div>
        <div>
          <label htmlFor="acc-password" className="text-xs uppercase tracking-[0.25em] text-beige/50">
            Password
          </label>
          <input
            id="acc-password"
            type="password"
            required
            autoComplete={tab === "login" ? "current-password" : "new-password"}
            className="mt-2 min-h-[44px] w-full rounded-lg border border-white/15 bg-transparent px-4 text-sm text-beige outline-none transition-colors focus:border-gold"
          />
        </div>

        <Button type="submit" className="w-full">
          {tab === "login" ? "Log In" : "Create Account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-beige/40">
        Order history, saved addresses and faster checkout will be available
        once your ZUNO account is set up.
      </p>
    </div>
  );
}
