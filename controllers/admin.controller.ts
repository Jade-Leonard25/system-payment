import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { userAdmin } from "../schema/schema";
import { createAuth } from "../auth";

type Bindings = { DB: D1Database };
const adminController = new Hono<{ Bindings: Bindings }>();

adminController.post("/", async (c) => {
  const auth = createAuth(c.env.DB, new URL(c.req.url).origin);
  const body = await c.req.json();
  if (body.role !== "employee") {
    return c.json({ error: "Use product-key registration to create an administrator account" }, 400);
  }

  const { role: _role, ...signUpData } = body;
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");

  const authRequest = new Request(
    new URL("/api/auth/sign-up/email", c.req.url).toString(),
    {
      method: "POST",
      headers,
      body: JSON.stringify(signUpData),
    },
  );

  const response = await auth.handler(authRequest);
  if (!response.ok) {
    return response;
  }

  const result = (await response.clone().json()) as {
    user?: { id?: string };
  };
  const userId = result.user?.id;
  if (!userId) {
    return c.json({ error: "Account created without a user ID in the response" }, 500);
  }

  const db = drizzle(c.env.DB);
  await db
    .update(userAdmin)
    .set({ role: "employee", updatedAt: new Date() })
    .where(eq(userAdmin.id, userId));

  return response;
});

// Get admin profile by ID
adminController.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");

  const [admin] = await db
    .select({
      id: userAdmin.id,
      name: userAdmin.name,
      email: userAdmin.email,
      emailVerified: userAdmin.emailVerified,
      image: userAdmin.image,
      createdAt: userAdmin.createdAt,
    })
    .from(userAdmin)
    .where(eq(userAdmin.id, id));

  if (!admin) {
    return c.json({ error: "Admin not found" }, 404);
  }

  return c.json({ data: admin });
});

export default adminController;
