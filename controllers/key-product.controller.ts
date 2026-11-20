import { Hono } from "hono";
import type { Context } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import { keyProduct } from "../schema/schema";
import { createAuth } from "../auth";
import {
  generateProductKey,
  hashProductKey,
  isProductKeyFormat,
  verifyProductKey,
} from "../key-products";

type Bindings = { DB: D1Database };
const keyProductController = new Hono<{ Bindings: Bindings }>();

async function adminAccess(c: Context<{ Bindings: Bindings }>) {
  const auth = createAuth(c.env.DB, new URL(c.req.url).origin);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return "unauthenticated";
  if (session.user.role !== "admin") return "forbidden";
  return null;
}

function accessError(c: Context<{ Bindings: Bindings }>, result: "unauthenticated" | "forbidden") {
  return result === "unauthenticated"
    ? c.json({ error: "Authentication required" }, 401)
    : c.json({ error: "Only administrators can manage product keys" }, 403);
}

keyProductController.post("/verify", async (c) => {
  let body: { key?: unknown } | null;
  try {
    body = await c.req.json<{ key?: unknown }>();
  } catch {
    return c.json({ valid: false }, 400);
  }

  if (!body || !isProductKeyFormat(body.key)) {
    return c.json({ valid: false }, 401);
  }

  const key = body.key.toLowerCase();
  const db = drizzle(c.env.DB);
  const [record] = await db
    .select()
    .from(keyProduct)
    .where(eq(keyProduct.keySelector, key.slice(0, 3)))
    .limit(1);

  if (!record || record.status !== "active" || !(await verifyProductKey(key, record.keyHash))) {
    return c.json({ valid: false }, 401);
  }

  return c.json({ valid: true, keyId: record.id });
});

keyProductController.post("/", async (c) => {
  const access = await adminAccess(c);
  if (access) return accessError(c, access);

  const db = drizzle(c.env.DB);
  let generated = generateProductKey();
  while (
    (
      await db
        .select({ id: keyProduct.id })
        .from(keyProduct)
        .where(eq(keyProduct.keySelector, generated.keySelector))
        .limit(1)
    ).length
  ) {
    generated = generateProductKey();
  }

  const record = {
    id: crypto.randomUUID(),
    keySelector: generated.keySelector,
    keyValue: generated.key,
    keyHash: await hashProductKey(generated.key),
    status: "active",
    createdAt: new Date(),
  };
  await db.insert(keyProduct).values(record);

  return c.json(
    {
      success: true,
      data: {
        id: record.id,
        key: generated.key,
        status: record.status,
        createdAt: record.createdAt,
      },
    },
    201,
  );
});

keyProductController.get("/", async (c) => {
  const access = await adminAccess(c);
  if (access) return accessError(c, access);

  const requestedLimit = Number(c.req.query("limit") ?? 100);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 1000) {
    return c.json({ error: "Limit must be an integer between 1 and 1000" }, 400);
  }

  const db = drizzle(c.env.DB);
  const records = await db
    .select({
      id: keyProduct.id,
      keySelector: keyProduct.keySelector,
      key: keyProduct.keyValue,
      status: keyProduct.status,
      createdAt: keyProduct.createdAt,
    })
    .from(keyProduct)
    .orderBy(desc(keyProduct.createdAt))
    .limit(requestedLimit);

  return c.json({ data: records, count: records.length });
});

keyProductController.delete("/:id", async (c) => {
  const access = await adminAccess(c);
  if (access) return accessError(c, access);

  const db = drizzle(c.env.DB);
  await db
    .update(keyProduct)
    .set({ status: "revoked" })
    .where(eq(keyProduct.id, c.req.param("id")));

  return c.json({ success: true });
});

export default keyProductController;
