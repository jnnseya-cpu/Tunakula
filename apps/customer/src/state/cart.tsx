import React, { createContext, useContext, useMemo, useState } from "react";
import type { MenuItem, MoneyWire } from "../api/types";

/**
 * The in-progress cart. One branch at a time (switching branch clears it, as the storefront does): a
 * delivery is dispatched from a single branch, so a cart spanning two is not a thing. Totals are shown
 * optimistically from menu prices; the authoritative price always comes from the server /carts/quote.
 */
export interface CartLine {
  readonly key: string; // item id + chosen options/addons, so the same dish with different options is a separate line
  readonly itemId: string;
  readonly name: string;
  readonly unitPrice: MoneyWire;
  readonly quantity: number;
  readonly options: string[];
  readonly addons: string[];
}

interface CartContextValue {
  branchId: string | null;
  branchName: string | null;
  lines: CartLine[];
  count: number;
  setBranch: (id: string, name: string) => void;
  add: (item: MenuItem, options?: string[], addons?: string[]) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const lineKey = (itemId: string, options: string[], addons: string[]) =>
  [itemId, [...options].sort().join("|"), [...addons].sort().join("|")].join("::");

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);

  const value = useMemo<CartContextValue>(
    () => ({
      branchId,
      branchName,
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      setBranch(id, name) {
        if (id !== branchId) {
          setBranchId(id);
          setBranchName(name);
          setLines([]); // a cart belongs to one branch
        }
      },
      add(item, options = [], addons = []) {
        const key = lineKey(item.id, options, addons);
        setLines((prev) => {
          const existing = prev.find((l) => l.key === key);
          if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
          return [...prev, { key, itemId: item.id, name: item.name, unitPrice: item.price, quantity: 1, options, addons }];
        });
      },
      setQuantity(key, quantity) {
        setLines((prev) => (quantity <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity } : l))));
      },
      clear() {
        setLines([]);
      },
    }),
    [branchId, branchName, lines],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
