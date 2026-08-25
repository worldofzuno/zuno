import MotionSection from "./MotionSection";
import RevealOnScroll from "./RevealOnScroll";

export default function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <MotionSection as="div" className="border-b border-white/10 bg-black py-20 sm:py-28">
      <div className="container-content max-w-2xl text-center">
        <RevealOnScroll>
          <p className="text-xs uppercase tracking-[0.4em] text-gold">
            {eyebrow}
          </p>
          <h1 className="text-balance mt-4 font-display text-4xl leading-tight text-beige sm:text-5xl">
            {title}
          </h1>
          {description && (
            <p className="mt-5 text-sm leading-relaxed text-beige/60">
              {description}
            </p>
          )}
        </RevealOnScroll>
      </div>
    </MotionSection>
  );
}
