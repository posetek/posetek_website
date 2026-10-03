// Review the exact composed release, including legacy public/media files.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stat } from "node:fs/promises";
import { createHomepagePreviewServer } from "./serve-homepage-preview.mjs";
const output = fileURLToPath(new URL("../production-dist/", import.meta.url));
for (const file of ["index.html", "coaches/index.html", "application.html"]) await stat(resolve(output, file));
const port = Number(process.env.PORT || 4175);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535");
createHomepagePreviewServer({ marketingRoot: output, referenceRoot: output })
  .listen(port, "127.0.0.1", () => console.log(`PoseTek composed Astro release: http://127.0.0.1:${port}`));
