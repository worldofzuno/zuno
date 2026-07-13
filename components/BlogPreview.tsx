import Link from "next/link";
import RevealOnScroll from "./RevealOnScroll";
import { IconArrowRight } from "./icons";

const posts = [
  {
    slug: "brewing-castano-at-home",
    tag: "Brewing Tips",
    title: "How to Brew Castano Like You Mean It",
    excerpt:
      "Grind size, water temperature and timing — the small details that separate a good cup from a great one.",
  },
  {
    slug: "origin-story-brazil-honduras",
    tag: "Origin",
    title: "From Brazil to Honduras: Sourcing Castano",
    excerpt:
      "A look at the farms and the people behind the beans that make Castano what it is.",
  },
  {
    slug: "starting-with-coffee",
    tag: "Brand",
    title: "Starting with Coffee. Not Stopping There.",
    excerpt:
      "Why ZUNO began with a bag of coffee — and why it won&apos;t end there.",
  },
];

export default function BlogPreview() {
  return (
    <section className="bg-black py-24 sm:py-32">
      <div className="container-content">
        <RevealOnScroll className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-gold">
              From the Journal
            </p>
            <h2 className="mt-4 font-display text-3xl text-beige sm:text-4xl">
              Stories, not just sales
            </h2>
          </div>
          <Link
            href="/blog"
            className="flex min-h-[44px] items-center gap-2 text-sm text-beige/70 transition-colors hover:text-gold"
          >
            View all stories <IconArrowRight className="h-4 w-4" />
          </Link>
        </RevealOnScroll>

        <div className="mt-14 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, i) => (
            <RevealOnScroll key={post.slug} delay={i * 0.08}>
              <Link href={`/blog/${post.slug}`} className="group block">
                <div
                  className="aspect-[4/3] w-full rounded-2xl border border-white/10 bg-gradient-to-br from-green/60 via-black to-black transition-colors duration-300 group-hover:border-gold/30"
                  aria-hidden="true"
                />
                <p className="mt-5 text-xs uppercase tracking-[0.3em] text-gold">
                  {post.tag}
                </p>
                <h3 className="mt-2 font-display text-xl text-beige transition-colors duration-200 group-hover:text-gold">
                  {post.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-beige/50">
                  {post.excerpt}
                </p>
              </Link>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
