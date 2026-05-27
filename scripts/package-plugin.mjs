import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const pluginId = "pr-review-for-obsidian";
const outDir = join("dist", pluginId);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const file of ["manifest.json", "main.js", "styles.css", "README.md"]) {
  await copyFile(file, join(outDir, file));
}

console.log(`Packaged ${pluginId} into ${outDir}`);
