import type { Metadata } from "next";
import PageIntro from "@/components/PageIntro";
import MotionSection from "@/components/MotionSection";
import RevealOnScroll from "@/components/RevealOnScroll";
import ContactForm from "@/components/ContactForm";
import { IconInstagram } from "@/components/icons";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with ZUNO — coffee, pricing, and partnership inquiries welcome.",
};

export default function ContactPage() {
  return (
    <>
      <PageIntro
        eyebrow="Get In Touch"
        title="Want to add some ZUNO vibes to your place?"
        description="Let us know — we're happy to share more about our coffee, pricing, and the potential for a perfect partnership. Because let's face it, life's better with a bit of ZUNO."
      />

      <MotionSection className="bg-black py-20 sm:py-28">
        <div className="container-content grid max-w-4xl grid-cols-1 gap-16 lg:grid-cols-[1.2fr_1fr]">
          <RevealOnScroll>
            <ContactForm />
          </RevealOnScroll>

          <RevealOnScroll delay={0.1}>
            <h2 className="font-display text-xl text-beige">Reach Us</h2>
            <p className="mt-3 text-sm text-beige/60">
              <a href="mailto:info@worldofzuno.com" className="hover:text-gold">
                info@worldofzuno.com
              </a>
            </p>
            <a
              href="https://instagram.com/worldofzuno"
              target="_blank"
              rel="noreferrer noopener"
              className="mt-6 flex min-h-[44px] w-fit items-center gap-3 text-sm text-beige/70 transition-colors hover:text-gold"
            >
              <IconInstagram className="h-5 w-5" />
              @worldofzuno
            </a>
          </RevealOnScroll>
        </div>
      </MotionSection>
    </>
  );
}
