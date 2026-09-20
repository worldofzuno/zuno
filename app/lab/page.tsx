import type { Metadata } from "next";
import PageIntro from "@/components/PageIntro";
import MotionSection from "@/components/MotionSection";
import KineticText from "@/components/KineticText";
import MagneticDock from "@/components/MagneticDock";
import StickyScrollCards from "@/components/StickyScrollCards";
import { IconAccount, IconCart, IconInstagram } from "@/components/icons";

export const metadata: Metadata = {
  title: "Motion Lab",
  description: "Three motion components built in the ZUNO design language.",
  // A workbench, not a page anyone should find through search.
  robots: { index: false, follow: false },
};

const dockItems = [
  {
    label: "Shop",
    href: "/shop",
    icon: <IconCart />,
  },
  {
    label: "Account",
    href: "/account",
    icon: <IconAccount />,
  },
  {
    label: "Instagram",
    href: "https://instagram.com/worldofzuno",
    icon: <IconInstagram />,
  },
];

const cards = [
  {
    eyebrow: "Origin",
    title: "Sourced where the bean already tastes like something",
    body: "Brazil for the body, Indonesia for the depth, India and Honduras for the edges. We buy on cup score, not on story, and we re-taste every lot before it goes near the roaster.",
  },
  {
    eyebrow: "Roast",
    title: "Roasted in Bern, in batches small enough to change our minds",
    body: "A profile is never finished. Small batches mean a lot can be pulled thirty seconds earlier next week if the cupping table says so.",
  },
  {
    eyebrow: "Rest",
    title: "Given the days it needs before it reaches you",
    body: "Coffee off the roaster is not ready. We let it settle so the gas leaves and the sweetness arrives, then ship it inside the window where it actually tastes the way we intended.",
  },
];

export default function LabPage() {
  return (
    <>
      <PageIntro
        eyebrow="Motion Lab"
        title="Three components, built in the house language"
        description="A workbench for judging motion before it goes near the site. Everything here uses the same curve, the same tokens and the same reduced-motion behaviour as the rest of ZUNO."
      />

      <MotionSection className="border-b border-white/10 py-20 sm:py-28">
        <div className="container-content max-w-3xl">
          <p className="text-xs uppercase tracking-[0.4em] text-gold">
            Kinetic text reveal
          </p>
          <KineticText
            text="Each word climbs out from behind its own edge"
            className="text-balance mt-5 font-display text-3xl leading-tight text-beige sm:text-5xl"
          />
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-beige/60">
            Split on words, never on characters: cutting mid-word breaks how a
            display face shapes its letters. The whole phrase stays one string
            for a screen reader — the split is decoration and is hidden from it.
          </p>
        </div>
      </MotionSection>

      <MotionSection className="border-b border-white/10 py-20 sm:py-28">
        <div className="container-content max-w-3xl">
          <p className="text-xs uppercase tracking-[0.4em] text-gold">
            Magnetic dock
          </p>
          <h2 className="mt-5 font-display text-2xl text-beige sm:text-3xl">
            Move a mouse across it
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-beige/60">
            Items swell as the pointer nears and settle on a spring, so the pull
            reverses the instant you do. On touch there is no pointer to follow,
            so the magnification stays off and the row sits at 44px — a full
            tap target rather than a shrunken one.
          </p>

          <div className="mt-12 flex justify-center pb-6">
            <MagneticDock items={dockItems} />
          </div>
        </div>
      </MotionSection>

      <div className="py-20 sm:py-28">
        <div className="container-content max-w-3xl">
          <p className="text-xs uppercase tracking-[0.4em] text-gold">
            Sticky scroll cards
          </p>
          <h2 className="mt-5 font-display text-2xl text-beige sm:text-3xl">
            Keep scrolling — they stack
          </h2>
          <p className="mt-4 mb-16 max-w-xl text-sm leading-relaxed text-beige/60">
            Each card pins, then recedes and darkens as the next slides over it.
            The scale follows scroll position rather than a timer, so reversing
            the scroll reverses the motion exactly.
          </p>

          <StickyScrollCards cards={cards} />
        </div>

        <div className="container-content mt-32 max-w-3xl">
          <p className="text-sm text-beige/40">
            End of the stack — the last card holds its size, since nothing
            arrives to cover it.
          </p>
        </div>
      </div>
    </>
  );
}
