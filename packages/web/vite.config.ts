import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // canvaskit-wasm ships a large emscripten glue module that must not be
  // pre-bundled/transformed by esbuild dep-optimization; it loads its .wasm
  // at runtime from /runtime-assets/canvaskit/ (committed in public/).
  optimizeDeps: {
    exclude: ["canvaskit-wasm"],
  },
});
