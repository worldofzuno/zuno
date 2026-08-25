import type { Metadata } from "next";
import Link from "next/link";
import PageIntro from "@/components/PageIntro";
import MotionSection from "@/components/MotionSection";
import RevealOnScroll from "@/components/RevealOnScroll";
import { posts } from "./posts";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Brand stories, coffee knowledge, brewing tips and community stories from ZUNO.",
};

export default function BlogIndexPage() {
  return (
    <>
      <PageIntro
        eyebrow="The Journal"
        title="Stories, not just sales"
        description="Brand stories, coffee knowledge, brewing tips and what's next for ZUNO."
      />

      <MotionSection className="bg-black py-20 sm:py-28">
        <div className="container-content grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
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
                <h2 className="mt-2 font-display text-xl text-beige transition-colors duration-200 group-hover:text-gold">
                  {post.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-beige/50">
                  {post.excerpt}
                </p>
              </Link>
            </RevealOnScroll>
          ))}
        </div>
      </MotionSection>
    </>
  );
}
