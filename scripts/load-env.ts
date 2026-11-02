/*
 * Loads env files for standalone scripts the same way Next.js does:
 * `.env.local` first, then `.env`. Variables already set (in the shell or by
 * an earlier file) are never overwritten, and missing files are skipped.
 */
import { existsSync } from "node:fs";
import path from "node:path";

for (const name of [".env.local", ".env"]) {
  const file = path.join(process.cwd(), name);
  if (existsSync(file)) process.loadEnvFile(file);
}
