// src/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";

export const createAuth = (d1: D1Database) => {
  const db = drizzle(d1);
  
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      // Map Better Auth's expected tables to your existing Drizzle schema tables
      schema: {
        user: "user_admin",
        session: "session",
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
    },
    // Add trusted origins or CORS settings if necessary
    trustedOrigins: ["http://localhost:5173"],
  });
};
