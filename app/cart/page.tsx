import type { Metadata } from "next";
import CartView from "./CartView";

export const metadata: Metadata = {
  title: "Your Cart",
};

export default function CartPage() {
  return (
    <div className="bg-black py-20 sm:py-28">
      <div className="container-content">
        <h1 className="text-center font-display text-3xl text-beige sm:text-4xl">
          Your Cart
        </h1>
        <div className="mt-14">
          <CartView />
        </div>
      </div>
    </div>
  );
}
