import { useDemo } from "../context";
import { ProductCard } from "../components/ProductCard";
import { CartItemRow } from "../components/CartItem";
import { ReviewItem } from "../components/ReviewItem";
import { RatingStars } from "../components/RatingStars";

export function AppPanel() {
  const { appState, mode } = useDemo();
  const {
    filteredProducts,
    cart,
    cartTotal,
    searchQuery,
    categoryFilter,
    categories,
    currentView,
    selectedProduct,
    productReviews,
    products,
  } = appState;

  const isInteractive = mode === "interactive";

  return (
    <div className="flex flex-col h-full bg-surface-low overflow-hidden">
      {/* Nav tabs */}
      <div className="flex items-center gap-4 px-4 h-10 bg-surface-container">
        <button
          data-click-target="nav-catalog"
          onClick={() => isInteractive && appState.navigate("catalog")}
          disabled={!isInteractive}
          className={`text-xs font-medium transition-colors disabled:cursor-default ${
            currentView === "catalog" || currentView === "product"
              ? "text-on-surface"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          Catalog
        </button>
        <button
          data-click-target="nav-cart"
          onClick={() => isInteractive && appState.navigate("cart")}
          disabled={!isInteractive}
          className={`text-xs font-medium transition-colors disabled:cursor-default flex items-center gap-1 ${
            currentView === "cart"
              ? "text-on-surface"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          Cart
          {cart.length > 0 && (
            <span className="font-mono text-[10px] bg-primary/20 text-primary px-1 rounded">
              {cart.length}
            </span>
          )}
        </button>
        <span className="text-[10px] font-mono text-on-surface-variant ml-auto uppercase tracking-wider">
          SLOP Shop
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {currentView === "catalog" && (
          <CatalogView
            products={filteredProducts}
            searchQuery={searchQuery}
            categoryFilter={categoryFilter}
            categories={categories}
            isInteractive={isInteractive}
          />
        )}
        {currentView === "product" && selectedProduct && (
          <ProductDetailView
            product={selectedProduct}
            reviews={productReviews}
            isInteractive={isInteractive}
          />
        )}
        {currentView === "cart" && (
          <CartView
            cart={cart}
            products={products}
            total={cartTotal}
            isInteractive={isInteractive}
          />
        )}
      </div>
    </div>
  );
}

function CatalogView({
  products,
  searchQuery,
  categoryFilter,
  categories,
  isInteractive,
}: {
  products: any[];
  searchQuery: string;
  categoryFilter: string | null;
  categories: string[];
  isInteractive: boolean;
}) {
  const { appState } = useDemo();

  return (
    <div className="flex flex-col gap-3">
      {/* Search bar */}
      <div className="bg-surface-highest rounded px-3 py-2 flex items-center gap-2">
        <span className="text-on-surface-variant text-xs">Search</span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => isInteractive && appState.search(e.target.value)}
          readOnly={!isInteractive}
          placeholder="Search products..."
          className="flex-1 bg-transparent text-sm text-on-surface font-mono placeholder:text-on-surface-variant/40 outline-none"
        />
      </div>

      {/* Category filters */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          data-click-target="filter-all"
          onClick={() => isInteractive && appState.filterByCategory(null)}
          disabled={!isInteractive}
          className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded transition-colors disabled:cursor-default ${
            !categoryFilter
              ? "bg-primary/20 text-primary"
              : "bg-surface-container text-on-surface-variant hover:text-on-surface"
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            data-click-target={`filter-${cat}`}
            onClick={() => isInteractive && appState.filterByCategory(cat)}
            disabled={!isInteractive}
            className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded transition-colors disabled:cursor-default ${
              categoryFilter === cat
                ? "bg-primary/20 text-primary"
                : "bg-surface-container text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Product grid */}
      <div className="grid grid-cols-2 gap-2">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>

      {products.length === 0 && (
        <p className="text-sm text-on-surface-variant text-center py-8">
          No products match your search.
        </p>
      )}
    </div>
  );
}

function ProductDetailView({
  product,
  reviews,
  isInteractive,
}: {
  product: any;
  reviews: any[];
  isInteractive: boolean;
}) {
  const { appState } = useDemo();

  return (
    <div className="flex flex-col gap-3">
      {/* Back button */}
      <button
        data-click-target="back-to-catalog"
        onClick={() => isInteractive && appState.navigate("catalog")}
        disabled={!isInteractive}
        className="text-xs text-secondary hover:text-on-surface self-start disabled:cursor-default"
      >
        ← Back to catalog
      </button>

      {/* Product info */}
      <div className="bg-surface-container rounded p-4">
        <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
          {product.category}
        </span>
        <h2 className="text-lg font-semibold text-on-surface mt-1">{product.name}</h2>
        <div className="flex items-center gap-2 mt-1">
          <RatingStars rating={product.rating} size="md" />
          <span className="font-mono text-xs text-on-surface-variant">
            ({product.reviewCount} reviews)
          </span>
        </div>
        <p className="font-mono text-xl text-primary mt-2">${product.price.toFixed(2)}</p>
        <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
          {product.description}
        </p>
        <div className="flex items-center gap-3 mt-3">
          <span className="text-xs text-on-surface-variant font-mono">
            {product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}
          </span>
          <button
            data-click-target="add-to-cart"
            onClick={() => isInteractive && appState.addToCart(product.id)}
            disabled={!isInteractive}
            className="px-3 py-1 rounded bg-primary/20 text-primary text-sm hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-default"
          >
            Add to Cart
          </button>
        </div>
      </div>

      {/* Reviews */}
      <div className="bg-surface-container rounded p-3">
        <h3 className="text-sm font-medium text-on-surface mb-2">
          Reviews ({reviews.length})
        </h3>
        {reviews.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No reviews yet.</p>
        ) : (
          <div className="divide-y divide-outline-variant/10">
            {reviews.map((r) => (
              <ReviewItem key={r.id} review={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CartView({
  cart,
  products,
  total,
  isInteractive,
}: {
  cart: any[];
  products: any[];
  total: number;
  isInteractive: boolean;
}) {
  const { appState } = useDemo();

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-on-surface">
        Shopping Cart ({cart.length} {cart.length === 1 ? "item" : "items"})
      </h2>

      {cart.length === 0 ? (
        <p className="text-sm text-on-surface-variant text-center py-8">
          Your cart is empty.
        </p>
      ) : (
        <>
          <div className="bg-surface-container rounded p-3 divide-y divide-outline-variant/10">
            {cart.map((item) => (
              <CartItemRow
                key={item.productId}
                item={item}
                product={products.find((p: any) => p.id === item.productId)}
              />
            ))}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between px-3 py-2 bg-surface-container rounded">
            <span className="text-sm text-on-surface-variant">Total</span>
            <span className="font-mono text-lg text-primary font-medium">
              ${total.toFixed(2)}
            </span>
          </div>

          <button
            onClick={() => isInteractive && appState.clearCart()}
            disabled={!isInteractive}
            className="text-xs text-error/60 hover:text-error self-start disabled:opacity-50 disabled:cursor-default"
          >
            Clear cart
          </button>
        </>
      )}
    </div>
  );
}
