// src/auth.ts
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/schema";

export const createAuth = (d1: D1Database, baseURL: string) => {
  const db = drizzle(d1, { schema });

  return betterAuth({
    baseURL,
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
        secure: baseURL.startsWith("https://"),
        sameSite: "none",
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
    },
    plugins: [bearer()],
    trustedOrigins: [
      "http://localhost:1420",
      "http://localhost:5173", // Vite dev server (tauri dev)
      "http://127.0.0.1:5173", // Alternative dev loopback
      "http://tauri.localhost", // Tauri v2 production origin
      "https://tauri.localhost", // Tauri v2 HTTPS scheme (if enabled)
      // If you register a custom protocol/deep-link scheme in Tauri (e.g. tauri-payroll):
      "tauri-payroll://*",
    ],
  });
};
