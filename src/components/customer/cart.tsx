"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { money } from "@/lib/customer/format";
export type Cart = {
  eventId: string;
  slug: string;
  title: string;
  lines: {
    tierId: string;
    name: string;
    quantity: number;
    priceKobo: number;
    holderNames: string[];
  }[];
};
const CartContext = createContext<{
  cart: Cart | null;
  save: (cart: Cart | null) => void;
}>({ cart: null, save: () => {} });
export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  useEffect(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem("sr-cart") ?? "null");
      if (
        value &&
        typeof value.eventId === "string" &&
        typeof value.slug === "string" &&
        typeof value.title === "string" &&
        Array.isArray(value.lines) &&
        value.lines.length > 0 &&
        value.lines.length <= 10 &&
        value.lines.every(
          (l: Cart["lines"][number]) =>
            l &&
            typeof l.tierId === "string" &&
            typeof l.name === "string" &&
            Number.isSafeInteger(l.priceKobo) &&
            l.priceKobo >= 0 &&
            Array.isArray(l.holderNames) &&
            l.holderNames.length <= 10 &&
            l.holderNames.every(
              (name) => typeof name === "string" && name.length <= 200,
            ) &&
            Number.isInteger(l.quantity) &&
            l.quantity > 0 &&
            l.quantity <= 10,
        ) &&
        value.lines.reduce(
          (n: number, l: Cart["lines"][number]) => n + l.quantity,
          0,
        ) <= 10
      ) {
        queueMicrotask(() => setCart(value));
      }
    } catch {
      /* empty cart */
    }
  }, []);
  function save(next: Cart | null) {
    setCart(next);
    try {
      if (next) sessionStorage.setItem("sr-cart", JSON.stringify(next));
      else sessionStorage.removeItem("sr-cart");
    } catch {
      /* works without storage */
    }
  }
  return (
    <CartContext.Provider value={{ cart, save }}>
      {children}
    </CartContext.Provider>
  );
}
export const useCart = () => useContext(CartContext);
export function CartLink() {
  const { cart } = useCart();
  const qty = cart?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;
  return (
    <Link href="/cart" aria-label={`Cart, ${qty} tickets`}>
      Cart <span className="badge">{qty}</span>
    </Link>
  );
}
export function CartPage() {
  const { cart, save } = useCart();
  return (
    <section className="narrow">
      <p className="eyebrow">YOUR NIGHT</p>
      <h1>Your cart</h1>
      {!cart ? (
        <div className="panel">
          <p>Your cart is empty. Find a night to remember.</p>
          <Link className="button" href="/events">
            Explore events
          </Link>
        </div>
      ) : (
        <div className="panel stack">
          <h2>{cart.title}</h2>
          {cart.lines.map((l) => (
            <p key={l.tierId}>
              {l.quantity} × {l.name}{" "}
              <strong>{money(l.quantity * l.priceKobo)}</strong>
            </p>
          ))}
          <p className="total">
            Estimated total{" "}
            <strong>
              {money(
                cart.lines.reduce((n, l) => n + l.quantity * l.priceKobo, 0),
              )}
            </strong>
          </p>
          <p className="muted">
            Prices and availability are checked at checkout. Tickets are
            reserved after you enter your details.
          </p>
          <Link className="button" href="/checkout">
            Continue to checkout
          </Link>
          <Link href={`/event/${encodeURIComponent(cart.slug)}#tickets`}>
            Change ticket quantities
          </Link>
          <button className="secondary" onClick={() => save(null)}>
            Clear cart
          </button>
        </div>
      )}
    </section>
  );
}
