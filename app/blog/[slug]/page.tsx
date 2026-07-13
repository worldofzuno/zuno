import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import RevealOnScroll from "@/components/RevealOnScroll";
import { getPost, posts } from "../posts";

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const post = getPost(params.slug);
  if (!post) return {};
  return { title: post.title, description: post.excerpt };
}

export default function BlogPostPage({
  params,
}: {
  params: { slug: string };
}) {
  const post = getPost(params.slug);
  if (!post) notFound();

  return (
    <article className="bg-black py-20 sm:py-28">
      <div className="container-content max-w-2xl">
        <RevealOnScroll>
          <Link
            href="/blog"
            className="text-xs uppercase tracking-[0.3em] text-beige/40 hover:text-gold"
          >
            &larr; Journal
          </Link>
          <p className="mt-6 text-xs uppercase tracking-[0.4em] text-gold">
            {post.tag}
          </p>
          <h1 className="text-balance mt-4 font-display text-3xl leading-tight text-beige sm:text-4xl">
            {post.title}
          </h1>
          <div
            className="mt-10 aspect-[16/9] w-full rounded-2xl border border-white/10 bg-gradient-to-br from-green/60 via-black to-black"
            aria-hidden="true"
          />
          <p className="mt-10 text-base leading-relaxed text-beige/70">
            {post.body}
          </p>
        </RevealOnScroll>
      </div>
    </article>
  );
}
