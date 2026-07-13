import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 2026">
      <p>
        ZUNO (&ldquo;we&rdquo;, &ldquo;us&rdquo;) respects your privacy. This
        page outlines how we collect, use and protect your personal data
        when you visit worldofzuno.com or purchase Castano.
      </p>
      <h2 className="font-display text-lg text-beige">Data We Collect</h2>
      <p>
        Contact details you provide via forms or checkout (name, email,
        shipping and billing address), order history, and basic analytics
        about how you use our site.
      </p>
      <h2 className="font-display text-lg text-beige">How We Use It</h2>
      <p>
        To process orders, provide customer support, send newsletters you
        opt into, and improve the ZUNO experience. We do not sell your data.
      </p>
      <h2 className="font-display text-lg text-beige">Your Rights</h2>
      <p>
        You may request access to, correction of, or deletion of your
        personal data at any time by contacting{" "}
        <a href="mailto:info@worldofzuno.com" className="text-gold">
          info@worldofzuno.com
        </a>
        .
      </p>
    </LegalPage>
  );
}
