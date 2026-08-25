import type { Metadata } from "next";
import ProductConfigurator from "@/components/ProductConfigurator";
import MotionSection from "@/components/MotionSection";
import RevealOnScroll from "@/components/RevealOnScroll";

export const metadata: Metadata = {
  title: "Shop Castano",
  description:
    "Meet Castano — ZUNO's specialty coffee. Choose your size and grind, priced in CHF, shipped across Switzerland and Liechtenstein.",
};

export default function ShopPage() {
  return (
    <MotionSection className="bg-black py-20 sm:py-28">
      <div className="container-content">
        <RevealOnScroll>
          <ProductConfigurator />
        </RevealOnScroll>

        <RevealOnScroll delay={0.1} className="mx-auto mt-24 max-w-2xl border-t border-white/10 pt-12 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-gold">
            Warning
          </p>
          <p className="mt-3 text-sm leading-relaxed text-beige/60">
            Once you&apos;ve tried Castano, going back to regular coffee is
            like trading a five-star meal for microwave noodles. Don&apos;t
            say we didn&apos;t warn you.
          </p>
        </RevealOnScroll>
      </div>
    </MotionSection>
  );
}
