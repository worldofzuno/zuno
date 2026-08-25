import MotionSection from "./MotionSection";
import RevealOnScroll from "./RevealOnScroll";
import NewsletterForm from "./NewsletterForm";
import { ButtonLink } from "./Button";

export default function ContactTeaser() {
  return (
    <MotionSection className="bg-green py-24 sm:py-32">
      <div className="container-content max-w-xl text-center">
        <RevealOnScroll>
          <p className="text-xs uppercase tracking-[0.4em] text-gold">
            Join the World of ZUNO
          </p>
          <h2 className="text-balance mt-4 font-display text-3xl text-beige sm:text-4xl">
            Want to add some ZUNO vibes to your place?
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-beige/70">
            Let us know — we&apos;re happy to share more about our coffee,
            pricing, and the potential for a perfect partnership.
          </p>
          <NewsletterForm />
          <div className="mt-8">
            <ButtonLink href="/contact" variant="outline">
              Get in Touch
            </ButtonLink>
          </div>
        </RevealOnScroll>
      </div>
    </MotionSection>
  );
}
