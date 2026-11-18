// src/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/schema";

export const createAuth = (d1: D1Database) => {
  const db = drizzle(d1, { schema });
  
  return betterAuth({
    baseURL: "https://system-payroll-api.developmentserver160.workers.dev", // 👈 Add your backend worker URL here
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.userAdmin,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    advanced: {
      cookie: { 
        secure: true, 
        sameSite: "none" 
      }
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
    },
    trustedOrigins: [
      "http://localhost:5173",
      "electron_payroll://*"
    ]
  });
};
