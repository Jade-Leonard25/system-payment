import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { userAdmin } from "../schema/schema";
import { createAuth } from "../auth";

type Bindings = { DB: D1Database };
const adminController = new Hono<{ Bindings: Bindings }>();

adminController.post("/", async (c) => {
  const auth = createAuth(c.env.DB, new URL(c.req.url).origin);
  const body = await c.req.json();
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");

  const authRequest = new Request(
    new URL("/api/auth/sign-up/email", c.req.url).toString(),
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );

  return auth.handler(authRequest);
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
