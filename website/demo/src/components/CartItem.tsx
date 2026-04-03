import type { CartItem as CartItemType, Product } from "../state";
import { useDemo } from "../context";

export function CartItemRow({
  item,
  product,
}: {
  item: CartItemType;
  product: Product | undefined;
}) {
  const { mode, appState } = useDemo();
  const isInteractive = mode === "interactive";
  const subtotal = (product?.price ?? 0) * item.quantity;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-on-surface truncate">{product?.name ?? "Unknown"}</p>
        <p className="text-xs text-on-surface-variant font-mono">
          ${product?.price.toFixed(2)} each
        </p>
      </div>

      {/* Quantity controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => isInteractive && appState.updateQuantity(item.productId, item.quantity - 1)}
          disabled={!isInteractive}
          className="w-5 h-5 flex items-center justify-center text-xs rounded bg-surface-highest text-on-surface-variant hover:text-on-surface disabled:opacity-50 disabled:cursor-default"
        >
          -
        </button>
        <span className="font-mono text-xs w-5 text-center text-on-surface">
          {item.quantity}
        </span>
        <button
          onClick={() => isInteractive && appState.updateQuantity(item.productId, item.quantity + 1)}
          disabled={!isInteractive}
          className="w-5 h-5 flex items-center justify-center text-xs rounded bg-surface-highest text-on-surface-variant hover:text-on-surface disabled:opacity-50 disabled:cursor-default"
        >
          +
        </button>
      </div>

      {/* Subtotal */}
      <span className="font-mono text-sm text-primary w-16 text-right">
        ${subtotal.toFixed(2)}
      </span>

      {/* Remove */}
      <button
        onClick={() => isInteractive && appState.removeFromCart(item.productId)}
        disabled={!isInteractive}
        className="text-xs text-error/60 hover:text-error disabled:opacity-50 disabled:cursor-default"
      >
        ×
      </button>
    </div>
  );
}
