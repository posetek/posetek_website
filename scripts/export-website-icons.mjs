// Format conversion of the approved outline master; no generated artwork.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const sharp = createRequire(new URL("../app/package.json", import.meta.url))("sharp");
const source = await readFile(join(root, "app/astro/public/brand/posetek-p.svg"));
const png = size => sharp(source).resize(size, size).flatten({ background: "#04130e" }).removeAlpha().toColourspace("srgb").png().toBuffer();
const sizes = [16, 32, 48, 256];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((bytes, index) => {
  const entry = 6 + index * 16, dimension = sizes[index] === 256 ? 0 : sizes[index];
  header[entry] = dimension; header[entry + 1] = dimension;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
});
const files = new Map([
  ["brand/posetek-p.svg", source], ["brand/posetek-p-96.png", await png(96)],
  ["apple-touch-icon.png", await png(180)], ["favicon.ico", Buffer.concat([header, ...images])],
]);
for (const directory of ["app/astro/public", "app/public"]) {
  for (const [name, bytes] of files) {
    const target = join(root, directory, name);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  }
}
await writeFile(join(root, "app/public/favicon.svg"), source);
console.log("Exported the approved P as SVG, 96px PNG, 180px touch icon and multi-size ICO for Astro and Vite.");
