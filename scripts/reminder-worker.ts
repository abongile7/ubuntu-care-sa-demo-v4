import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Preserve an explicit DATABASE_URL (including disposable test databases).
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(path.join(projectRoot, ".env")))
  process.loadEnvFile(path.join(projectRoot, ".env"));
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL or create the project's .env before running reminders.");
const watch = process.argv.includes("--watch");
if (process.argv.slice(2).some((argument) => argument !== "--watch" && argument !== "--once"))
  throw new Error("Usage: tsx scripts/reminder-worker.ts [--once | --watch]");
async function main() {
  const { processDueReminders } = await import("../lib/portal-scheduling");
  const { prisma } = await import("../lib/prisma");
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    wake?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    do {
      const result = await processDueReminders();
      console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
      if (watch && !stopping)
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, 30_000);
        });
    } while (watch && !stopping);
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Reminder worker failed.");
  process.exitCode = 1;
});
