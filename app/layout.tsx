import type { Metadata } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { CartProvider } from "@/components/CartContext";

// Stand-in for the licensed Felix Titling headline font until the file is supplied.
const display = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://worldofzuno.com"),
  title: {
    default: "ZUNO — Starting with Coffee. Not Stopping There.",
    template: "%s — ZUNO",
  },
  description:
    "ZUNO is a modern Swiss lifestyle brand starting with specialty coffee. Meet Castano — quality, origin, design and community in every cup.",
  keywords: ["ZUNO", "specialty coffee", "Swiss coffee brand", "Castano coffee"],
  openGraph: {
    title: "ZUNO — Starting with Coffee. Not Stopping There.",
    description:
      "A modern Swiss lifestyle brand starting with specialty coffee. Today it's coffee. Tomorrow, who knows.",
    url: "https://worldofzuno.com",
    siteName: "ZUNO",
    locale: "en_CH",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ZUNO — Starting with Coffee. Not Stopping There.",
    description: "A modern Swiss lifestyle brand starting with specialty coffee.",
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-6 focus:top-6 focus:z-[100] focus:rounded-full focus:bg-gold focus:px-5 focus:py-2 focus:text-black"
        >
          Skip to main content
        </a>
        <CartProvider>
          <Nav />
          <main id="main-content">{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
