import { ButtonLink } from "@/components/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center bg-black px-6 text-center">
      <p className="text-xs uppercase tracking-[0.4em] text-gold">404</p>
      <h1 className="mt-4 font-display text-3xl text-beige sm:text-4xl">
        This page wandered off.
      </h1>
      <p className="mt-4 max-w-sm text-sm text-beige/60">
        Even the best-roasted beans get lost sometimes. Let&apos;s get you
        back on track.
      </p>
      <div className="mt-8">
        <ButtonLink href="/">Back Home</ButtonLink>
      </div>
    </div>
  );
}
