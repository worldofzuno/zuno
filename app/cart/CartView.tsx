"use client";

import { useCart } from "@/components/CartContext";
import { ButtonLink } from "@/components/Button";

export default function CartView() {
  const { items, removeItem, subtotal } = useCart();

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-beige/60">Your cart is empty.</p>
        <div className="mt-8">
          <ButtonLink href="/shop">Shop Castano</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <ul className="divide-y divide-white/10 border-y border-white/10">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-4 py-6"
          >
            <div>
              <p className="font-display text-lg text-beige">{item.name}</p>
              <p className="mt-1 text-sm text-beige/50">
                {item.size} &middot; {item.grind} &middot; Qty {item.quantity}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gold">
                CHF {(item.priceChf * item.quantity).toFixed(2)}
              </span>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="min-h-[44px] cursor-pointer text-xs uppercase tracking-wide text-beige/40 hover:text-gold"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex items-center justify-between">
        <span className="text-sm text-beige/60">Subtotal</span>
        <span className="font-display text-xl text-gold">
          CHF {subtotal.toFixed(2)}
        </span>
      </div>
      <p className="mt-2 text-xs text-beige/40">
        Shipping CHF 4.90 &middot; Free from CHF 45 &middot; Checkout coming
        soon.
      </p>

      <div className="mt-8">
        <ButtonLink href="/shop" variant="outline">
          Continue Shopping
        </ButtonLink>
      </div>
    </div>
  );
}
