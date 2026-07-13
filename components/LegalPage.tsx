export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-black py-20 sm:py-28">
      <div className="container-content max-w-2xl">
        <h1 className="font-display text-3xl text-beige sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-xs uppercase tracking-[0.25em] text-beige/40">
          Last updated {updated}
        </p>
        <div className="prose-legal mt-10 space-y-6 text-sm leading-relaxed text-beige/70">
          {children}
        </div>
      </div>
    </div>
  );
}
