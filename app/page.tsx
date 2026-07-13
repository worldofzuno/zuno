import Hero from "@/components/Hero";
import ProductTeaser from "@/components/ProductTeaser";
import AboutPreview from "@/components/AboutPreview";
import FacesSection from "@/components/FacesSection";
import BlogPreview from "@/components/BlogPreview";
import ContactTeaser from "@/components/ContactTeaser";

export default function HomePage() {
  return (
    <>
      <Hero />
      <ProductTeaser />
      <AboutPreview />
      <FacesSection />
      <BlogPreview />
      <ContactTeaser />
    </>
  );
}
