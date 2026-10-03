import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";

// Astro owns the document entries; authenticated screens remain one client-only
// React application. Static hosting needs no server adapter or new auth layer.
export default defineConfig({
  site: "https://posetek.net",
  srcDir: "./astro",
  // Public legacy files come only from the verified release baseline.
  publicDir: "./astro/public",
  outDir: "./astro-dist",
  output: "static",
  build: { format: "preserve", assets: "_astro", inlineStylesheets: "never" },
  integrations: [react(), svelte(), {
    name: "posetek-application-dev-routes",
    hooks: {
      "astro:server:setup": ({ server }) => {
        server.middlewares.use((request, _response, next) => {
          const url = new URL(request.url || "/", "http://localhost");
          // Mirror Netlify's application fallback during Astro development,
          // without intercepting source modules, generated assets, or marketing.
          if (/^\/(?:signin|kickai\.html|feed(?:\.html)?|organization|join|roster|coachesview\.html|dashboard|programs|insights|admin(?:\/.*)?|athlete|profile\.html|drills\/.*|broadJumpPage\.html|changeOfDirectionPage\.html|dribblingPage\.html|privacy(?:\.html)?|support)\/?$/.test(url.pathname)) {
            request.url = "/application" + url.search;
          }
          next();
        });
      },
    },
  }],
  vite: { plugins: [tailwindcss()], build: { chunkSizeWarningLimit: 1500 } },
  devToolbar: { enabled: false },
});
