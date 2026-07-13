import type { MetadataRoute } from "next";
import { posts } from "./blog/posts";

const base = "https://worldofzuno.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    "",
    "/shop",
    "/about",
    "/contact",
    "/blog",
    "/account",
    "/privacy-policy",
    "/shipping-policy",
    "/return-policy",
  ].map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
  }));

  const postRoutes = posts.map((post) => ({
    url: `${base}/blog/${post.slug}`,
    lastModified: new Date(),
  }));

  return [...staticRoutes, ...postRoutes];
}
