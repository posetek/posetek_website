import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";

export const sha1 = bytes => createHash("sha1").update(bytes).digest("hex");
export function containedPath(root, path) {
  if (!/^\/[A-Za-z0-9_./-]+$/.test(path) || path.split("/").includes("..")) throw new Error("Invalid generated path: " + path);
  const target = resolve(root, "." + path), rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Generated path escapes output");
  return target;
}
export async function assertPlainPath(root, target) {
  let current = resolve(root);
  const rel = relative(current, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Generated path escapes output");
  for (const part of ["", ...rel.split(/[\\/]/).filter(Boolean)]) {
    current = part ? join(current, part) : current;
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("Symbolic links are not permitted in release output");
      if (current !== target && !info.isDirectory()) throw new Error("Release ancestor must be a directory");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

// An ordinary marketing release may add content-addressed Astro assets, but must
// never replace the app's retained chunks (including case-folded Netlify aliases).
export async function mergeAstroAssets(source, output, protectedFiles = []) {
  const pinned = new Map(protectedFiles.map(file => [file.path.toLowerCase(), file]));
  const records = [], seen = new Map();
  async function inspect(directory, prefix = "/_astro") {
    await assertPlainPath(source, directory);
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + "/" + item.name, target = containedPath(output, path);
      const input = containedPath(source, path);
      if (item.isDirectory()) { await inspect(input, path); continue; }
      if (!item.isFile() || !/\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(path)) throw new Error("Expected a hashed Astro asset: " + path);
      await assertPlainPath(source, input); await assertPlainPath(output, target);
      const bytes = await readFile(input), record = { path, sha: sha1(bytes), size: bytes.length };
      const key = path.toLowerCase(), prior = pinned.get(key) || seen.get(key);
      if (prior && (prior.sha !== record.sha || prior.size !== record.size)) throw new Error("Astro asset collision: " + path);
      if (prior) continue;
      // Also protect existing non-baseline output so shared build stages cannot
      // silently replace a chunk emitted earlier in the same release.
      try {
        const existing = await readFile(target);
        if (sha1(existing) !== record.sha || existing.length !== record.size) throw new Error("Astro output collision: " + path);
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      seen.set(key, record); records.push({ ...record, target, bytes });
    }
  }
  await inspect(join(source, "_astro"));
  for (const record of records) {
    await assertPlainPath(output, record.target);
    await mkdir(dirname(record.target), { recursive: true });
    await writeFile(record.target, record.bytes);
  }
  return records.map(({ target, bytes, ...record }) => record);
}
