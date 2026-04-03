import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5175,
  },
  resolve: {
    dedupe: ["solid-js"],
  },
});
