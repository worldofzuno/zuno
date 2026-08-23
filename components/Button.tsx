import Link from "next/link";
import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-sm font-medium tracking-wide cursor-pointer min-h-[44px] transition-[transform,background-color,border-color,color] duration-press ease-premium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold active:scale-[0.97]";

const variants: Record<Variant, string> = {
  primary: "bg-gold text-black hover:bg-gold/90",
  outline: "border border-gold/40 text-gold hover:border-gold hover:bg-gold/5",
  ghost: "text-beige hover:text-gold",
};

export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
