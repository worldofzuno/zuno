export default function ProductVisual({
  size = "500g",
  className = "",
}: {
  size?: "200g" | "500g";
  className?: string;
}) {
  return (
    <div
      className={`relative aspect-[4/5] w-full overflow-hidden rounded-[2rem] ${className}`}
      style={{
        background:
          "radial-gradient(ellipse 90% 70% at 50% 15%, rgba(248,217,155,0.16) 0%, rgba(30,57,50,0.5) 45%, rgba(0,0,0,0.95) 100%)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center p-10">
        <div
          className="relative flex aspect-[3/4] w-full max-w-[220px] flex-col items-center justify-between rounded-2xl border border-gold/20 bg-black/40 py-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-sm"
          role="img"
          aria-label={`ZUNO Castano coffee bag, ${size}`}
        >
          <span className="font-display text-lg tracking-[0.3em] text-gold">
            ZUNO
          </span>
          <div className="flex flex-col items-center gap-1">
            <span className="font-display text-2xl text-beige">Castano</span>
            <span className="text-xs uppercase tracking-[0.25em] text-beige/50">
              {size}
            </span>
          </div>
          <span className="h-8 w-8 rounded-full border border-gold/30" />
        </div>
      </div>
    </div>
  );
}
