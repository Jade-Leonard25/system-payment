import { Hono } from "hono";
import type { Context } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import { keyProduct } from "../schema/schema";
import { userAdmin } from "../schema/schema";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

keyProductController.post("/activate", async (c) => {
  let body: { key?: unknown } | null;
  try {
    body = await c.req.json<{ key?: unknown }>();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  if (!body || !isProductKeyFormat(body.key)) {
    return c.json({ error: "A valid product key is required" }, 400);
  }

  const key = body.key.toLowerCase();
  const db = drizzle(c.env.DB);
  const [record] = await db
    .select({
      id: keyProduct.id,
      keyHash: keyProduct.keyHash,
      status: keyProduct.status,
      activatedAt: keyProduct.activatedAt,
    })
    .from(keyProduct)
    .where(eq(keyProduct.keySelector, key.slice(0, 3)))
    .limit(1);

  if (!record || !(await verifyProductKey(key, record.keyHash))) {
    return c.json({ error: "Invalid or inactive product key" }, 401);
  }

  if (record.status === "activated") {
    return c.json({ error: "This product key has already been activated" }, 409);
  }

  if (record.status !== "active") {
    return c.json({ error: "Invalid or inactive product key" }, 401);
  }

  const activatedAt = new Date();
  const [activatedRecord] = await db
    .update(keyProduct)
    .set({ status: "activated", activatedAt })
    .where(and(eq(keyProduct.id, record.id), eq(keyProduct.status, "active")))
    .returning({ id: keyProduct.id });

  if (!activatedRecord) {
    return c.json({ error: "This product key has already been activated or is no longer active" }, 409);
  }

  return c.json({
    success: true,
    activated: true,
    keyId: record.id,
    activatedAt,
  });
});

keyProductController.post("/register-admin", async (c) => {
  let body: { key?: unknown; name?: unknown; email?: unknown; password?: unknown } | null;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  if (
    !body ||
    !isProductKeyFormat(body.key) ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    typeof body.email !== "string" ||
    !body.email.trim() ||
    typeof body.password !== "string" ||
    body.password.length < 6
  ) {
    return c.json(
      { error: "Provide an activated key, name, valid email, and password with at least 6 characters" },
      400,
    );
  }

  const key = body.key.toLowerCase();
  const db = drizzle(c.env.DB);
  const [record] = await db
    .select({
      id: keyProduct.id,
      keyHash: keyProduct.keyHash,
      status: keyProduct.status,
    })
    .from(keyProduct)
    .where(eq(keyProduct.keySelector, key.slice(0, 3)))
    .limit(1);

  if (!record || !(await verifyProductKey(key, record.keyHash))) {
    return c.json({ error: "Invalid product key" }, 401);
  }
  if (record.status !== "activated") {
    return c.json(
      { error: record.status === "redeemed" ? "This key has already been used to register an account" : "Activate this key before registering" },
      409,
    );
  }

  const [reservation] = await db
    .update(keyProduct)
    .set({ status: "registration_pending" })
    .where(and(eq(keyProduct.id, record.id), eq(keyProduct.status, "activated")))
    .returning({ id: keyProduct.id });

  if (!reservation) {
    return c.json({ error: "This key is already being used to register an account" }, 409);
  }

  const auth = createAuth(c.env.DB, new URL(c.req.url).origin);
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const signupRequest = new Request(
    new URL("/api/auth/sign-up/email", c.req.url).toString(),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: body.name.trim(),
        email: body.email.trim(),
        password: body.password,
      }),
    },
  );
  const signupResponse = await auth.handler(signupRequest);

  if (!signupResponse.ok) {
    await db
      .update(keyProduct)
      .set({ status: "activated" })
      .where(and(eq(keyProduct.id, record.id), eq(keyProduct.status, "registration_pending")));
    return signupResponse;
  }

  let signupResult: unknown;
  try {
    signupResult = await signupResponse.clone().json();
  } catch {
    await db
      .update(keyProduct)
      .set({ status: "activated" })
      .where(and(eq(keyProduct.id, record.id), eq(keyProduct.status, "registration_pending")));
    return c.json({ error: "Registration succeeded without a valid user response" }, 502);
  }

  if (
    !isRecord(signupResult) ||
    !isRecord(signupResult.user) ||
    typeof signupResult.user.id !== "string"
  ) {
    await db
      .update(keyProduct)
      .set({ status: "activated" })
      .where(and(eq(keyProduct.id, record.id), eq(keyProduct.status, "registration_pending")));
    return c.json({ error: "Registration succeeded without a user ID" }, 502);
  }
  const userId = signupResult.user.id;

  const now = new Date();
  const batchResults = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE user_admin SET role = 'admin', key_product_id = ?, updated_at = ? WHERE id = ?",
    ).bind(record.id, Math.floor(now.getTime() / 1000), userId),
    c.env.DB.prepare(
      "UPDATE key_product SET status = 'redeemed' WHERE id = ? AND status = 'registration_pending'",
    ).bind(record.id),
  ]);

  if (!batchResults[0]?.meta.changes || !batchResults[1]?.meta.changes) {
    return c.json({ error: "Account was created but the key could not be linked; contact support" }, 500);
  }

  const responseHeaders = new Headers(signupResponse.headers);
  responseHeaders.delete("content-length");
  responseHeaders.set("content-type", "application/json");
  return new Response(
    JSON.stringify({
      ...signupResult,
      user: { ...signupResult.user, role: "admin", keyProductId: record.id },
    }),
    { status: signupResponse.status, headers: responseHeaders },
  );
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
