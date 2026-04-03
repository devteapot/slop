export type ReplayStep =
  | { type: "system"; delay: number; content: string }
  | { type: "user_message"; delay: number; content: string }
  | { type: "ai_message"; delay: number; content: string }
  | {
      type: "tool_call";
      delay: number;
      path: string;
      action: string;
      params?: Record<string, unknown>;
    }
  | { type: "tool_result"; delay: number }
  | {
      type: "ui_action";
      delay: number;
      label: string; // what the user is doing, shown in status bar
      mutation: string; // name of appState mutation function
      args?: any[]; // arguments to pass
      clickTarget?: string; // data-click-target value to highlight
    };

export const replayScript: ReplayStep[] = [
  // 1. Connection
  {
    type: "system",
    delay: 800,
    content: "AI agent connected. Observing store state...",
  },

  // 2. User asks for help
  {
    type: "user_message",
    delay: 1500,
    content: "I need wireless headphones under $100. Can you find the best option?",
  },

  // 3. AI responds and starts searching
  {
    type: "ai_message",
    delay: 1200,
    content:
      "Let me search the catalog for headphones and find the best option for you.",
  },

  // 4. Search
  {
    type: "tool_call",
    delay: 800,
    path: "/shop/catalog",
    action: "search",
    params: { query: "headphones" },
  },
  { type: "tool_result", delay: 400 },

  // 5. AI reads results
  {
    type: "ai_message",
    delay: 1500,
    content:
      'I found the "Wireless Headphones Pro" at $79.99 with a 4.7 star rating. Let me pull up the full details.',
  },

  // 6. View details
  {
    type: "tool_call",
    delay: 800,
    path: "/shop/catalog/wireless-headphones-pro",
    action: "view_details",
  },
  { type: "tool_result", delay: 400 },

  // 7. AI presents findings
  {
    type: "ai_message",
    delay: 1800,
    content:
      "Here's what I found:\n\n• Active noise cancellation\n• 30-hour battery life\n• Bluetooth 5.3 with multipoint\n• 4.7 stars across 23 reviews\n• $79.99 — well under your budget\n\nWant me to add it to your cart?",
  },

  // 8. User confirms
  {
    type: "user_message",
    delay: 2000,
    content: "Yes, add it to my cart!",
  },

  // 9. Add to cart
  {
    type: "ai_message",
    delay: 800,
    content: "Adding it now.",
  },
  {
    type: "tool_call",
    delay: 600,
    path: "/shop/product",
    action: "add_to_cart",
    params: { quantity: 1 },
  },
  { type: "tool_result", delay: 400 },

  // 10. AI confirms cart
  {
    type: "ai_message",
    delay: 1200,
    content:
      "Done — it's in your cart. Total is $79.99. I can also leave a review if you'd like.",
  },

  // 11. User asks for review
  {
    type: "user_message",
    delay: 1800,
    content: "Sure, leave a review based on what you know about it.",
  },

  // 12. Write review
  {
    type: "ai_message",
    delay: 800,
    content: "Writing a review based on the specs and existing feedback.",
  },
  {
    type: "tool_call",
    delay: 800,
    path: "/shop/product/reviews",
    action: "add_review",
    params: {
      author: "AI Assistant",
      rating: 5,
      text: "Excellent noise cancellation and battery life at this price point. The Bluetooth 5.3 multipoint is a standout feature. Best value under $100.",
    },
  },
  { type: "tool_result", delay: 400 },

  // 13. Summary
  {
    type: "ai_message",
    delay: 1500,
    content:
      "All done! I searched the catalog, found the best headphones under $100, added them to your cart, and left a review. Anything else?",
  },

  // User browses on their own — state tree updates from UI interaction
  {
    type: "ui_action",
    delay: 2000,
    label: "User navigated to catalog",
    mutation: "navigate",
    args: ["catalog"],
    clickTarget: "nav-catalog",
  },

  // User clears the search
  {
    type: "ui_action",
    delay: 800,
    label: "User cleared search filters",
    mutation: "clearFilters",
    clickTarget: "filter-all",
  },

  // User filters by home category
  {
    type: "ui_action",
    delay: 1000,
    label: 'User filtered by "home" category',
    mutation: "filterByCategory",
    args: ["home"],
    clickTarget: "filter-home",
  },

  // User views the desk lamp
  {
    type: "ui_action",
    delay: 1200,
    label: "User viewing LED Desk Lamp",
    mutation: "selectProduct",
    args: ["desk-lamp-led"],
    clickTarget: "product-desk-lamp-led",
  },

  // User adds to cart
  {
    type: "ui_action",
    delay: 1500,
    label: "User added LED Desk Lamp to cart",
    mutation: "addToCart",
    args: ["desk-lamp-led", 1],
    clickTarget: "add-to-cart",
  },
];

// Count all visible steps (everything except tool_result which is just a continuation)
export const TOTAL_STEPS = replayScript.filter((s) => s.type !== "tool_result").length;
