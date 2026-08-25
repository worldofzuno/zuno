import MotionSection from "./MotionSection";
import RevealOnScroll from "./RevealOnScroll";
import ProductVisual from "./ProductVisual";
import { ButtonLink } from "./Button";

export default function ProductTeaser() {
  return (
    <MotionSection className="bg-black py-24 sm:py-32">
      <div className="container-content grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
        <RevealOnScroll>
          <ProductVisual size="500g" className="mx-auto max-w-md" />
        </RevealOnScroll>

        <RevealOnScroll delay={0.1}>
          <p className="text-xs uppercase tracking-[0.4em] text-gold">
            The First Chapter
          </p>
          <h2 className="text-balance mt-4 font-display text-3xl leading-tight text-beige sm:text-4xl">
            Meet Castano — Because Ordinary Coffee is Just So&hellip;
            Ordinary
          </h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-beige/60">
            Smooth elegance, nutty notes, and just the right touch of
            sweetness. Sourced from Brazil, Indonesia, India and Honduras,
            roasted to perfection. One coffee, done properly.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <ButtonLink href="/shop">Shop Castano</ButtonLink>
            <span className="text-sm text-beige/40">From CHF 14.90</span>
          </div>
        </RevealOnScroll>
      </div>
    </MotionSection>
  );
}
