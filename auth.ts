// src/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/schema"; // Import your schema definitions

export const createAuth = (d1: D1Database) => {
  // Pass the schema to Drizzle so it knows about your tables and relations
  const db = drizzle(d1, { schema });
  
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      // Map Better Auth fields/tables to your custom Drizzle schema objects
      schema: {
        user: schema.userAdmin,
        session: schema.session,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
    },
    // Add trusted origins or CORS settings if necessary
    trustedOrigins:["electron_payroll://http://localhost:5173"]
  });
};
