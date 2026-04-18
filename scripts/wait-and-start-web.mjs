/**
 * 等后端 /health 可访问后再启动 Vite，避免 concurrently 同时拉起时
 * 前端首屏请求代理到未监听的端口（ECONNREFUSED）。
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import waitOn from "wait-on";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, "apps", "server", ".env");

function readPortFromEnvFile() {
  if (!existsSync(envPath)) return null;
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = /^PORT\s*=\s*(\d+)\s*$/i.exec(t);
      if (m) {
        const n = Number(m[1], 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveApiPort() {
  const fromShell = process.env.PORT?.trim();
  if (fromShell && /^\d+$/.test(fromShell)) {
    const n = Number(fromShell, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return readPortFromEnvFile() ?? 8787;
}

const port = resolveApiPort();
const url = `http-get://127.0.0.1:${port}/health`;

// eslint-disable-next-line no-console
console.info(`[dev] 等待后端就绪: ${url.replace("http-get://", "http://")}（最多 120s）…`);

await waitOn({
  resources: [url],
  timeout: 120_000,
  interval: 200,
});

// eslint-disable-next-line no-console
console.info("[dev] 后端已响应，启动前端 Vite …\n");

const child = spawn("npm", ["run", "dev", "-w", "@qusetion-repair/web"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code == null ? 1 : code);
});
