import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { userAdmin } from "../schema/schema";
import { generateCustomId } from "../customID";

type Bindings = { DB: D1Database };
const adminController = new Hono<{ Bindings: Bindings }>();

// Create an admin (for testing before Better Auth is mounted)
adminController.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();
  const now = new Date();

  const newAdmin = {
    id: generateCustomId(),
    name: body.name,
    email: body.email,
    emailVerified: false,
    image: body.image ?? null,
    password: body.password,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(userAdmin).values(newAdmin);

  // Never return the password in the JSON response
  const { password, ...safeAdmin } = newAdmin;
  return c.json({ success: true, data: safeAdmin }, 201);
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

