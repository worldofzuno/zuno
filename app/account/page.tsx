import type { Metadata } from "next";
import PageIntro from "@/components/PageIntro";
import RevealOnScroll from "@/components/RevealOnScroll";
import AccountPanel from "@/components/AccountPanel";

export const metadata: Metadata = {
  title: "Account",
  description: "Log in or create your ZUNO account.",
};

export default function AccountPage() {
  return (
    <>
      <PageIntro eyebrow="Members Area" title="Your ZUNO Account" />
      <div className="bg-black py-20 sm:py-28">
        <div className="container-content">
          <RevealOnScroll>
            <AccountPanel />
          </RevealOnScroll>
        </div>
      </div>
    </>
  );
}
