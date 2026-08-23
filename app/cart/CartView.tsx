"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCart } from "@/components/CartContext";
import { ButtonLink } from "@/components/Button";

const swap = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
};

export default function CartView() {
  const { items, removeItem, subtotal } = useCart();
  const empty = items.length === 0;

  return (
    /* mode="wait" lets the filled cart finish fading before the empty state
       arrives, so removing the last item reads as one movement instead of a
       hard swap between two layouts. */
    <AnimatePresence mode="wait" initial={false}>
      {empty ? (
        <motion.div key="empty" {...swap} className="py-16 text-center">
          <p className="text-beige/60">Your cart is empty.</p>
          <div className="mt-8">
            <ButtonLink href="/shop">Shop Castano</ButtonLink>
          </div>
        </motion.div>
      ) : (
        <motion.div key="filled" {...swap} className="mx-auto max-w-2xl">
          <ul className="divide-y divide-white/10 border-y border-white/10">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.li
                  key={item.id}
                  layout
                  initial={false}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center justify-between gap-4 overflow-hidden py-6"
                >
                  <div>
                    <p className="font-display text-lg text-beige">{item.name}</p>
                    <p className="mt-1 text-sm text-beige/50">
                      {item.size} &middot; {item.grind} &middot; Qty{" "}
                      {item.quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gold">
                      CHF {(item.priceChf * item.quantity).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="min-h-[44px] cursor-pointer text-xs uppercase tracking-wide text-beige/40 transition-[transform,color] duration-press ease-premium active:scale-[0.97] hover:text-gold"
                    >
                      Remove
                    </button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          <div className="mt-8 flex items-center justify-between">
            <span className="text-sm text-beige/60">Subtotal</span>
            <span className="font-sans text-xl font-semibold tracking-wide text-gold">
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
