import type { Metadata } from "next";
import PageIntro from "@/components/PageIntro";
import MotionSection from "@/components/MotionSection";
import RevealOnScroll from "@/components/RevealOnScroll";
import FacesSection from "@/components/FacesSection";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "ZUNO is a modern Swiss lifestyle brand starting with specialty coffee — built by two friends on quality, design and community.",
};

const sections = [
  {
    eyebrow: "ZUNO Who?",
    title:
      "The brand that comes to life when two friends realize their coffee is too good to keep to themselves.",
    body: "With ZUNO, we want to create something that's exclusive, high-quality, and a little different — not just in flavor, but also in the way it feels. Today, our name stands for coffee, but ZUNO is more than just a drink. It's our starting point, a brand that grows and evolves with you — who knows where this journey might lead?",
  },
  {
    eyebrow: "What Do We Stand For?",
    title: "We don't do things halfway. “Good enough” just isn't good enough.",
    body: "When we develop a product, we pour our hearts into it with precision and the ambition to create something special. At ZUNO, every detail counts, and each product is designed to give you an experience you won't forget.",
  },
  {
    eyebrow: "Where Are We Headed?",
    title: "Today, ZUNO is coffee. Tomorrow? Maybe something completely different.",
    body: "We're ready for surprises — and you should be too. One thing is certain: ZUNO is just getting started, and we are just as curious as you are about what comes next.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageIntro
        eyebrow="Our Story"
        title="Starting with Coffee. Not Stopping There."
        description="Today, ZUNO is coffee. Tomorrow, it could be something completely different."
      />

      <div className="bg-black">
        {sections.map((section, i) => (
          <MotionSection
            key={section.eyebrow}
            className={i % 2 === 1 ? "bg-green" : "bg-black"}
          >
            <div className="container-content max-w-2xl py-20 sm:py-24">
              <RevealOnScroll>
                <p className="text-xs uppercase tracking-[0.4em] text-gold">
                  {section.eyebrow}
                </p>
                <h2 className="text-balance mt-4 font-display text-2xl leading-snug text-beige sm:text-3xl">
                  {section.title}
                </h2>
                <p className="mt-5 text-sm leading-relaxed text-beige/60">
                  {section.body}
                </p>
              </RevealOnScroll>
            </div>
          </MotionSection>
        ))}
      </div>

      <FacesSection />
    </>
  );
}
