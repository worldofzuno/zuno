import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Return Policy" };

export default function ReturnPolicyPage() {
  return (
    <LegalPage title="Return Policy" updated="July 2026">
      <p>
        We want you to love your Castano. If something isn&apos;t right,
        reach out to us within 14 days of delivery at{" "}
        <a href="mailto:info@worldofzuno.com" className="text-gold">
          info@worldofzuno.com
        </a>{" "}
        and we&apos;ll help sort it out.
      </p>
      <h2 className="font-display text-lg text-beige">Eligibility</h2>
      <p>
        Unopened, unused products in original packaging are eligible for
        return or exchange. Opened coffee bags can only be returned if
        there is a quality issue.
      </p>
      <h2 className="font-display text-lg text-beige">Refunds</h2>
      <p>
        Once your return is received and inspected, we&apos;ll process your
        refund to the original payment method within 5–10 business days.
      </p>
    </LegalPage>
  );
}
