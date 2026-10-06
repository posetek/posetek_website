import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { sha1, containedPath, assertPlainPath } from "./astro-assets.mjs";

// Stable, same-origin assets: the PNG is also suitable for Google Search.
export const ICON_ASSETS = ["/favicon.ico", "/brand/posetek-p.svg", "/brand/posetek-p-96.png", "/apple-touch-icon.png"];
export const ICON_LINKS = '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48 256x256">' +
  '<link rel="icon" type="image/png" sizes="96x96" href="/brand/posetek-p-96.png">' +
  '<link rel="icon" type="image/svg+xml" sizes="any" href="/brand/posetek-p.svg">' +
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">';

// Keep every other head byte and the entire body unchanged, including scripts,
// private application bootstrap and the isolated feedback document.
export function updateIconLinks(html) {
  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, head => {
    let replaced = false;
    const updated = head.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*>/gi, link => {
      if (!/^<link\b/i.test(link)) return link;
      const rel = link.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const tokens = (rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? "").toLowerCase().split(/\s+/);
      if (!tokens.some(token => ["icon", "apple-touch-icon", "apple-touch-icon-precomposed"].includes(token))) return link;
      if (replaced) return "";
      replaced = true;
      return ICON_LINKS;
    });
    return replaced ? updated : updated.replace(/<\/head\s*>/i, closing => ICON_LINKS + closing);
  });
}

// Ordinary builds may add the declared icons, or retain their exact pinned
// bytes. Replacing already-pinned icon bytes requires a separately reviewed
// extension to the explicit scoped release; never bypass the ordinary guard.
export async function mergeWebsiteIcons(source, output, protectedFiles = []) {
  const pinned = new Map(protectedFiles.map(file => [file.path.toLowerCase(), file]));
  const records = [];
  for (const path of ICON_ASSETS) {
    const input = containedPath(source, path), target = containedPath(output, path);
    await assertPlainPath(source, input); await assertPlainPath(output, target);
    const bytes = await readFile(input), record = { path, sha: sha1(bytes), size: bytes.length };
    const prior = pinned.get(path.toLowerCase());
    if (prior && (prior.sha !== record.sha || prior.size !== record.size)) throw Error("Website icon collision: " + path);
    try {
      const existing = await readFile(target);
      if (sha1(existing) !== record.sha || existing.length !== record.size) throw Error("Website icon output collision: " + path);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    records.push({ ...record, bytes, target });
  }
  for (const { bytes, target } of records) {
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  }
  return records.map(({ bytes, target, ...record }) => record);
}
