import type { Context } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { createAuth } from "../auth";

type Bindings = { DB: D1Database };

export async function requireAdmin(c: Context<{ Bindings: Bindings }>) {
  const auth = createAuth(c.env.DB, new URL(c.req.url).origin);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return { response: c.json({ error: "Authentication required" }, 401) };
  }
  if (session.user.role !== "admin") {
    return { response: c.json({ error: "Administrator access required" }, 403) };
  }
  return { userId: session.user.id };
}
