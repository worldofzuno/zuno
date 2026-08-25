import MotionSection from "./MotionSection";
import RevealOnScroll from "./RevealOnScroll";
import { ButtonLink } from "./Button";

export default function AboutPreview() {
  return (
    <MotionSection className="relative overflow-hidden bg-green py-24 sm:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-gold/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-beige/5 blur-3xl"
      />

      <div className="container-content relative max-w-3xl">
        <RevealOnScroll>
          <p className="text-xs uppercase tracking-[0.4em] text-gold">
            ZUNO Who?
          </p>
          <h2 className="text-balance mt-4 font-display text-3xl leading-tight text-beige sm:text-4xl">
            The brand that comes to life when two friends realize their
            coffee is too good to keep to themselves.
          </h2>
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-beige/70">
            Today, our name stands for coffee. But ZUNO is more than just a
            drink — it&apos;s our starting point. A brand that grows and
            evolves with you. Who knows where this journey might lead?
          </p>
          <div className="mt-8">
            <ButtonLink href="/about" variant="outline">
              Our Story
            </ButtonLink>
          </div>
        </RevealOnScroll>
      </div>
    </MotionSection>
  );
}
