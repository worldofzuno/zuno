import RevealOnScroll from "./RevealOnScroll";

export default function FacesSection() {
  return (
    <section className="bg-black py-24 sm:py-32">
      <div className="container-content grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
        <RevealOnScroll>
          <div
            className="relative flex aspect-[4/5] w-full max-w-md items-center justify-center rounded-[2rem] border border-white/10 bg-gradient-to-br from-beige/[0.06] to-transparent"
            role="img"
            aria-label="Portrait placeholder for the two ZUNO founders"
          >
            <span className="text-xs uppercase tracking-[0.3em] text-beige/30">
              Founders photo — coming soon
            </span>
          </div>
        </RevealOnScroll>

        <RevealOnScroll delay={0.1}>
          <p className="text-xs uppercase tracking-[0.4em] text-gold">
            Faces Behind ZUNO
          </p>
          <h2 className="text-balance mt-4 font-display text-3xl leading-tight text-beige sm:text-4xl">
            Two friends. No big plans. Just a desire to bring an idea to
            life.
          </h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-beige/60">
            ZUNO is what happens when you sit together, talk about
            everything and nothing, and then think, &ldquo;Why not just go
            for it?&rdquo; It&apos;s not about the end goal — it&apos;s about
            building a community that&apos;s just as excited as we are.
          </p>
        </RevealOnScroll>
      </div>
    </section>
  );
}
