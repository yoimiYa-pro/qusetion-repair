/**
 * 构建前清空 `dist`，但保留宝塔 / 面板常见的 `.user.ini`（防跨站等），
 * 避免 Vite 内置 emptyDir 与面板文件冲突导致 ENOTDIR / 构建失败。
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

if (!existsSync(distDir)) {
  process.exit(0);
}

const keep = new Set([".user.ini"]);

for (const name of readdirSync(distDir)) {
  if (keep.has(name)) continue;
  rmSync(path.join(distDir, name), { recursive: true, force: true });
}
