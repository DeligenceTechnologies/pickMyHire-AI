import { z } from "zod";
import { body, route } from "@/lib/api";
import { repeatQuestion } from "@/lib/interview/controller";

const Schema = z.object({
  question_id: z.string().uuid(),
  kind: z.enum(["repeat", "clarify", "unclear"]),
  text: z.string().max(2_000),
});

export const POST = route<{ token: string }>(async (req, { token }) => repeatQuestion(token, await body(req, Schema)), {
  rateLimit: { key: "pub-repeat", limit: 30, windowMs: 60_000 },
});
