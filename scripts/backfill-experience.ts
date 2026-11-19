/*
 * Fill in total experience (calculated from the resume's role dates) for candidates analysed before it
 * existed. Uses only the already-extracted profile: no AI calls. Safe to run again.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-experience.ts
 */
import postgres from "postgres";
import { calculateExperience } from "../lib/resume/experience";
import type { ResumeProfile } from "../lib/validation/ai-schemas";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.system', 'on', true)`;
      const rows = await tx<{ id: string; parsed_profile: ResumeProfile }[]>`select id, parsed_profile from candidates where parsed_profile is not null`;
      let flagged = 0;
      for (const r of rows) {
        const exp = calculateExperience(r.parsed_profile.roles ?? [], { statedYears: r.parsed_profile.years_experience ?? null });
        if (exp.flags.length) flagged++;
        await tx`update candidates set experience_months = ${exp.months}, experience_approximate = ${exp.approximate},
          experience_flags = ${tx.json(exp.flags)} where id = ${r.id}`;
      }
      console.log(`updated ${rows.length} candidates (${flagged} with dates to check)`);
    });
  } finally {
    await sql.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
