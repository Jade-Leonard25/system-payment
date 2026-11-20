import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { userAdmin } from "../schema/schema";

type Bindings = { DB: D1Database };
const adminController = new Hono<{ Bindings: Bindings }>();

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
