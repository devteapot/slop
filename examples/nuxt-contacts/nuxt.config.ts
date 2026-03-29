export default defineNuxtConfig({
  devtools: { enabled: false },
  app: {
    head: {
      meta: [{ name: "slop", content: "ws://localhost:3000/slop" }],
    },
  },
  nitro: {
    experimental: { websocket: true },
  },
});
