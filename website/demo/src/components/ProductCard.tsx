import type { Product } from "../state";
import { RatingStars } from "./RatingStars";
import { useDemo } from "../context";

const CATEGORY_COLORS: Record<string, string> = {
  electronics: "text-secondary",
  books: "text-primary",
  home: "text-amber",
};

export function ProductCard({ product }: { product: Product }) {
  const { mode, appState } = useDemo();
  const isInteractive = mode === "interactive";

  return (
    <div data-click-target={`product-${product.id}`} className="bg-surface-container rounded p-3 flex flex-col gap-2">
      {/* Category + price */}
      <div className="flex items-center justify-between">
        <span className={`font-mono text-[10px] uppercase tracking-wider ${CATEGORY_COLORS[product.category] ?? "text-on-surface-variant"}`}>
          {product.category}
        </span>
        <span className="font-mono text-sm font-medium text-primary">
          ${product.price.toFixed(2)}
        </span>
      </div>

      {/* Name */}
      <h3 className="text-sm font-medium text-on-surface leading-tight">
        {product.name}
      </h3>

      {/* Rating */}
      <div className="flex items-center gap-1.5">
        <RatingStars rating={product.rating} />
        <span className="text-[10px] text-on-surface-variant font-mono">
          ({product.reviewCount})
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        <button
          onClick={() => isInteractive && appState.selectProduct(product.id)}
          disabled={!isInteractive}
          className="text-[11px] text-secondary hover:text-on-surface transition-colors disabled:opacity-50 disabled:cursor-default"
        >
          Details
        </button>
        <button
          onClick={() => isInteractive && appState.addToCart(product.id)}
          disabled={!isInteractive}
          className="text-[11px] ml-auto px-2 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-50 disabled:cursor-default"
        >
          Add to Cart
        </button>
      </div>
    </div>
  );
}
