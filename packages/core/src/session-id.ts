import { z } from "zod";
import { FormaError } from "./errors.js";

export const sessionIdSchema = z.string().regex(/^S-[a-f0-9]{16}$/);

export function parseSessionId(sessionId: string): string {
  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) {
    throw new FormaError("INVALID_INPUT", "Session id is invalid", { session_id: sessionId });
  }
  return parsed.data;
}
