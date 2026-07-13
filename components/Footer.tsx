import Link from "next/link";
import { IconInstagram } from "./icons";
import NewsletterForm from "./NewsletterForm";

const shopLinks = [
  { href: "/shop", label: "Castano" },
  { href: "/account", label: "Account" },
  { href: "/cart", label: "Cart" },
];

const companyLinks = [
  { href: "/about", label: "About Us" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
];

const legalLinks = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/shipping-policy", label: "Shipping Policy" },
  { href: "/return-policy", label: "Return Policy" },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-black">
      <div className="container-content grid grid-cols-1 gap-12 py-16 md:grid-cols-[1.3fr_1fr_1fr_1.3fr]">
        <div>
          <span className="font-display text-2xl tracking-[0.15em] text-gold">
            ZUNO
          </span>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-beige/60">
            Starting with Coffee. Not Stopping There.
          </p>
          <a
            href="https://instagram.com/worldofzuno"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="ZUNO on Instagram"
            className="mt-5 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/10 text-beige/70 transition-colors hover:border-gold hover:text-gold"
          >
            <IconInstagram className="h-5 w-5" />
          </a>
        </div>

        <FooterColumn title="Shop" links={shopLinks} />
        <FooterColumn title="Company" links={companyLinks} />

        <div>
          <h3 className="text-sm font-medium tracking-wide text-beige/90">
            Join the World of ZUNO
          </h3>
          <p className="mt-3 text-sm text-beige/60">
            New products, brand news, and future releases.
          </p>
          <NewsletterForm compact />
        </div>
      </div>

      <div className="border-t border-white/5">
        <div className="container-content flex flex-col-reverse items-center justify-between gap-4 py-6 text-xs text-beige/40 sm:flex-row">
          <p>&copy; {new Date().getFullYear()} ZUNO. All rights reserved.</p>
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {legalLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-gold">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <h3 className="text-sm font-medium tracking-wide text-beige/90">{title}</h3>
      <ul className="mt-4 space-y-3">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-sm text-beige/60 transition-colors hover:text-gold"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
