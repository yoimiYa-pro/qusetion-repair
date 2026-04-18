import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 与 apps/server/.env 中的 PORT 对齐，避免改了后端端口而 Vite 仍代理到 8787 导致 Failed to fetch。
 * 优先级：环境变量 VITE_API_PROXY > server/.env 的 PORT > 8787
 */
function readServerPortFromEnvFile(): number {
  const envPath = path.join(__dirname, "../server/.env");
  if (!existsSync(envPath)) return 8787;
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = /^PORT\s*=\s*(\d+)\s*$/i.exec(t);
      if (m) {
        const n = Number(m[1], 10);
        return Number.isFinite(n) && n > 0 ? n : 8787;
      }
    }
  } catch {
    /* ignore */
  }
  return 8787;
}

const serverPort = readServerPortFromEnvFile();
const apiTarget =
  process.env.VITE_API_PROXY?.trim() || `http://127.0.0.1:${serverPort}`;

/** 生产子路径部署：构建前设置 `VITE_BASE_PATH=/你的前缀/`（须以 / 开头、建议以 / 结尾） */
const rawBasePath = process.env.VITE_BASE_PATH?.trim();
const base =
  !rawBasePath || rawBasePath === "/"
    ? "/"
    : rawBasePath.endsWith("/")
      ? rawBasePath
      : `${rawBasePath}/`;

/** 与 `base` 对齐的 dev/preview 代理前缀，如 `/repair/api` → 后端根路径 */
const apiProxyPrefix = `${base}api`.replace(/\/{2,}/g, "/");

const apiProxy = {
  [apiProxyPrefix]: {
    target: apiTarget,
    changeOrigin: true,
    rewrite: (p: string) => (p.startsWith(apiProxyPrefix) ? p.slice(apiProxyPrefix.length) : p),
  },
};

// eslint-disable-next-line no-console
console.info(`[vite] base=${base}  proxy ${apiProxyPrefix} -> ${apiTarget}`);

export default defineConfig({
  base,
  plugins: [react()],
  /** 见 `scripts/clean-dist.mjs`：宝塔常在 dist 下放 `.user.ini`，与 Vite 默认 emptyDir 冲突 */
  build: {
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    proxy: { ...apiProxy },
  },
  preview: {
    port: 4173,
    proxy: { ...apiProxy },
  },
});
