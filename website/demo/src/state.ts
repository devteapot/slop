import { useState, useCallback } from "react";
import { action, useSlop } from "@slop-ai/react";
import { slop } from "./slop";

// --- Data model ---

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  rating: number;
  reviewCount: number;
  stock: number;
  description: string;
}

export interface Review {
  id: string;
  productId: string;
  author: string;
  rating: number;
  text: string;
  date: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export type ViewType = "catalog" | "product" | "cart";

export interface AppState {
  products: Product[];
  reviews: Review[];
  cart: CartItem[];
  searchQuery: string;
  categoryFilter: string | null;
  currentView: ViewType;
  selectedProductId: string | null;
}

// --- Seed data ---

const SEED_PRODUCTS: Product[] = [
  { id: "wireless-headphones-pro", name: "Wireless Headphones Pro", category: "electronics", price: 79.99, rating: 4.7, reviewCount: 23, stock: 15, description: "Premium wireless headphones with active noise cancellation, 30-hour battery life, and crystal-clear sound. Bluetooth 5.3 with multipoint connection." },
  { id: "smart-speaker-mini", name: "Smart Speaker Mini", category: "electronics", price: 49.99, rating: 4.3, reviewCount: 89, stock: 42, description: "Compact smart speaker with rich sound, voice assistant built-in, and seamless multi-room audio support." },
  { id: "usb-c-hub", name: "USB-C Hub 7-in-1", category: "electronics", price: 34.99, rating: 4.5, reviewCount: 156, stock: 78, description: "7-in-1 USB-C hub with HDMI 4K, USB 3.0, SD card reader, and 100W power delivery pass-through." },
  { id: "mechanical-keyboard", name: "Mechanical Keyboard TKL", category: "electronics", price: 129.99, rating: 4.8, reviewCount: 67, stock: 8, description: "Tenkeyless mechanical keyboard with hot-swappable switches, RGB backlighting, and aluminum frame." },
  { id: "design-patterns-book", name: "Design Patterns in TypeScript", category: "books", price: 39.99, rating: 4.6, reviewCount: 34, stock: 120, description: "Comprehensive guide to design patterns with modern TypeScript examples. Covers creational, structural, and behavioral patterns." },
  { id: "clean-architecture-book", name: "Clean Architecture", category: "books", price: 29.99, rating: 4.4, reviewCount: 201, stock: 85, description: "Robert C. Martin's guide to software architecture principles. A must-read for serious developers." },
  { id: "ceramic-mug-set", name: "Ceramic Mug Set (4-pack)", category: "home", price: 24.99, rating: 4.2, reviewCount: 45, stock: 200, description: "Set of 4 handcrafted ceramic mugs in earthy tones. Microwave and dishwasher safe. 12oz capacity." },
  { id: "desk-lamp-led", name: "LED Desk Lamp", category: "home", price: 44.99, rating: 4.6, reviewCount: 112, stock: 33, description: "Adjustable LED desk lamp with 5 brightness levels, 3 color temperatures, and USB charging port." },
];

const SEED_REVIEWS: Review[] = [
  { id: "r1", productId: "wireless-headphones-pro", author: "Alex M.", rating: 5, text: "Best headphones I've owned. The noise cancellation is incredible for the price.", date: "2026-03-15" },
  { id: "r2", productId: "wireless-headphones-pro", author: "Sam K.", rating: 4, text: "Great sound quality. Battery lasts forever. Wish the ear cups were slightly larger.", date: "2026-03-10" },
  { id: "r3", productId: "wireless-headphones-pro", author: "Jordan P.", rating: 5, text: "Unbeatable value under $100. Use them daily for work calls and music.", date: "2026-02-28" },
  { id: "r4", productId: "smart-speaker-mini", author: "Chris L.", rating: 4, text: "Surprisingly powerful sound for its size. Voice assistant works well.", date: "2026-03-20" },
  { id: "r5", productId: "smart-speaker-mini", author: "Taylor R.", rating: 5, text: "Perfect for the kitchen. Love the multi-room feature.", date: "2026-03-01" },
  { id: "r6", productId: "mechanical-keyboard", author: "Dev_Mike", rating: 5, text: "The typing feel is sublime. Hot-swap switches are a game changer.", date: "2026-03-18" },
  { id: "r7", productId: "mechanical-keyboard", author: "KeyboardFan", rating: 5, text: "Best TKL I've used. Build quality is top tier.", date: "2026-02-20" },
  { id: "r8", productId: "design-patterns-book", author: "TSEnthusiast", rating: 5, text: "Finally a patterns book that uses TypeScript properly. Every example compiles.", date: "2026-03-22" },
  { id: "r9", productId: "clean-architecture-book", author: "ArchNerd", rating: 4, text: "Uncle Bob delivers again. Some chapters feel repetitive but the core ideas are solid.", date: "2026-01-15" },
  { id: "r10", productId: "desk-lamp-led", author: "NightOwl", rating: 5, text: "Perfect for late-night coding sessions. The warm light setting is easy on the eyes.", date: "2026-03-25" },
  { id: "r11", productId: "usb-c-hub", author: "LaptopUser", rating: 4, text: "Works great with my MacBook. All ports detected instantly.", date: "2026-03-12" },
  { id: "r12", productId: "ceramic-mug-set", author: "CoffeeLover", rating: 4, text: "Beautiful mugs. Good size for morning coffee. One arrived with a tiny chip.", date: "2026-02-14" },
];

let nextReviewId = 100;

// --- Hook ---

export function useAppState() {
  const [products] = useState<Product[]>(SEED_PRODUCTS);
  const [reviews, setReviews] = useState<Review[]>(SEED_REVIEWS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<ViewType>("catalog");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  // --- Derived ---

  const filteredProducts = products.filter((p) => {
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase()) && !p.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (categoryFilter && p.category !== categoryFilter) return false;
    return true;
  });

  const selectedProduct = selectedProductId
    ? products.find((p) => p.id === selectedProductId) ?? null
    : null;

  const productReviews = selectedProductId
    ? reviews.filter((r) => r.productId === selectedProductId)
    : [];

  const cartTotal = cart.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.productId);
    return sum + (product?.price ?? 0) * item.quantity;
  }, 0);

  const categories = [...new Set(products.map((p) => p.category))];

  // --- Mutations ---

  const search = useCallback((query: string) => {
    setSearchQuery(query);
    setCurrentView("catalog");
  }, []);

  const filterByCategory = useCallback((category: string | null) => {
    setCategoryFilter(category);
    setCurrentView("catalog");
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setCategoryFilter(null);
  }, []);

  const selectProduct = useCallback((id: string) => {
    setSelectedProductId(id);
    setCurrentView("product");
  }, []);

  const addToCart = useCallback((productId: string, quantity: number = 1) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === productId);
      if (existing) {
        return prev.map((i) =>
          i.productId === productId
            ? { ...i, quantity: i.quantity + quantity }
            : i,
        );
      }
      return [...prev, { productId, quantity }];
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((i) => i.productId !== productId));
    } else {
      setCart((prev) =>
        prev.map((i) =>
          i.productId === productId ? { ...i, quantity } : i,
        ),
      );
    }
  }, []);

  const addReview = useCallback(
    (productId: string, author: string, rating: number, text: string) => {
      const review: Review = {
        id: `r-${nextReviewId++}`,
        productId,
        author,
        rating,
        text,
        date: new Date().toISOString().split("T")[0],
      };
      setReviews((prev) => [...prev, review]);
    },
    [],
  );

  const navigate = useCallback((view: ViewType) => {
    setCurrentView(view);
    if (view === "catalog") setSelectedProductId(null);
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const resetState = useCallback(() => {
    setReviews([...SEED_REVIEWS]);
    setCart([]);
    setSearchQuery("");
    setCategoryFilter(null);
    setCurrentView("catalog");
    setSelectedProductId(null);
    nextReviewId = 100;
  }, []);

  // --- SLOP registration ---

  // Catalog node
  useSlop(slop, "catalog", () => ({
    type: "collection",
    props: {
      total: products.length,
      showing: filteredProducts.length,
      query: searchQuery || null,
      category: categoryFilter,
    },
    actions: {
      search: action({ query: "string" }, ({ query }) => search(query)),
      filter_category: action(
        { category: "string" },
        ({ category }) => filterByCategory(category),
      ),
      clear_filters: action(() => clearFilters()),
    },
    items: filteredProducts.map((p) => ({
      id: p.id,
      props: {
        name: p.name,
        price: p.price,
        rating: p.rating,
        reviewCount: p.reviewCount,
        stock: p.stock,
        category: p.category,
      },
      actions: {
        view_details: action(() => selectProduct(p.id)),
        add_to_cart: action(
          { quantity: { type: "number", description: "Quantity to add" } },
          ({ quantity }) => addToCart(p.id, quantity ?? 1),
        ),
      },
    })),
  }));

  // Product detail node (only when a product is selected)
  useSlop(
    slop,
    "product",
    () =>
      selectedProduct
        ? {
          type: "view",
          props: {
            name: selectedProduct.name,
            price: selectedProduct.price,
            rating: selectedProduct.rating,
            stock: selectedProduct.stock,
            description: selectedProduct.description,
            category: selectedProduct.category,
          },
          actions: {
            add_to_cart: action(
              { quantity: { type: "number", description: "Quantity to add" } },
              ({ quantity }) => addToCart(selectedProduct.id, quantity ?? 1),
            ),
            back_to_catalog: action(() => navigate("catalog")),
          },
          children: {
            reviews: {
              type: "collection",
              props: {
                count: productReviews.length,
                averageRating: productReviews.length
                  ? +(
                      productReviews.reduce((s, r) => s + r.rating, 0) /
                      productReviews.length
                    ).toFixed(1)
                  : 0,
              },
              actions: {
                add_review: action(
                  {
                    author: "string",
                    rating: { type: "number", description: "Rating 1-5" },
                    text: "string",
                  },
                  ({ author, rating, text }) =>
                    addReview(selectedProduct.id, author, rating, text),
                ),
              },
              items: productReviews.map((r) => ({
                id: r.id,
                props: {
                  author: r.author,
                  rating: r.rating,
                  text: r.text,
                  date: r.date,
                },
              })),
            },
          },
        }
        : { type: "view", props: { empty: true } },
  );

  // Cart node
  useSlop(slop, "cart", () => ({
    type: "collection",
    props: {
      itemCount: cart.length,
      total: +cartTotal.toFixed(2),
    },
    actions: {
      clear_cart: action(() => clearCart(), { dangerous: true }),
    },
    items: cart.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      return {
        id: item.productId,
        props: {
          productName: product?.name ?? "Unknown",
          price: product?.price ?? 0,
          quantity: item.quantity,
          subtotal: +((product?.price ?? 0) * item.quantity).toFixed(2),
        },
        actions: {
          update_quantity: action(
            { quantity: { type: "number", description: "New quantity" } },
            ({ quantity }) => updateQuantity(item.productId, quantity),
          ),
          remove: action(() => removeFromCart(item.productId)),
        },
      };
    }),
  }));

  // Navigation node
  useSlop(slop, "navigation", () => ({
    type: "status",
    props: {
      currentView,
      selectedProduct: selectedProduct?.name ?? null,
    },
    actions: {
      go_to_catalog: action(() => navigate("catalog")),
      go_to_cart: action(() => navigate("cart")),
    },
  }));

  return {
    products,
    filteredProducts,
    reviews,
    productReviews,
    cart,
    cartTotal,
    searchQuery,
    categoryFilter,
    categories,
    currentView,
    selectedProduct,
    selectedProductId,
    // Mutations
    search,
    filterByCategory,
    clearFilters,
    selectProduct,
    addToCart,
    removeFromCart,
    updateQuantity,
    addReview,
    navigate,
    clearCart,
    resetState,
  };
}
