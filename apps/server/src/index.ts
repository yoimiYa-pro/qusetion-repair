import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { JobStore } from "./jobStore.js";
import { registerRoutes } from "./routes.js";

const PORT = Number(process.env.PORT?.trim() || 8787) || 8787;
const HOST = process.env.HOST?.trim() || "0.0.0.0";
/** `.env` 里 `DATA_DIR=` 留空时，`??` 不会回退，会导致 mkdir('') */
const DATA_DIR =
  process.env.DATA_DIR?.trim() || join(process.cwd(), "data", "jobs");

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const jobStore = new JobStore(join(DATA_DIR, "jobs.sqlite"));

  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 10,
    },
  });

  await registerRoutes(app, jobStore);

  app.addHook("onClose", async () => {
    jobStore.close();
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Server listening on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
