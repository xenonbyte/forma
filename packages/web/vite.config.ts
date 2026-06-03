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
  build: {
    rollupOptions: {
      // vzi-format's encoder imports Node-only modules (zlib brotliCompressSync,
      // crypto) that cannot be bundled for the browser. The encoder is never
      // called in the web app (only VZIDecoder is used); externalising these
      // Node built-ins lets the dead-code path resolve without a bundler error.
      external: ["zlib", "crypto"],
    },
  },
});
