import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { slopPlugin } from "@slop-ai/server/vite";
import { slop } from "./src/lib/server/slop";

export default defineConfig({
  plugins: [
    sveltekit(),
    slopPlugin(slop),
  ],
});
