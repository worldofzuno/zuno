import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = { title: "Shipping Policy" };

export default function ShippingPolicyPage() {
  return (
    <LegalPage title="Shipping Policy" updated="July 2026">
      <h2 className="font-display text-lg text-beige">Regions</h2>
      <p>We currently ship to Switzerland and the Principality of Liechtenstein.</p>
      <h2 className="font-display text-lg text-beige">Delivery Time</h2>
      <p>Orders arrive within 1–3 business days of dispatch.</p>
      <h2 className="font-display text-lg text-beige">Shipping Cost</h2>
      <p>
        A flat rate of CHF 4.90 applies to all orders. Shipping is free on
        orders of CHF 45 or more.
      </p>
    </LegalPage>
  );
}
