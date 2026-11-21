// src/auth.ts
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/schema";
import { appendAuditEvent } from "./services/audit";

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
    databaseHooks: {
      session: {
        create: {
          after: async (createdSession) => {
            const memberships = await d1
              .prepare(
                `SELECT company_id
                 FROM company_memberships
                 WHERE user_id = ?`,
              )
              .bind(createdSession.userId)
              .all<{ company_id: string }>();
            for (const membership of memberships.results) {
              await appendAuditEvent(d1, {
                companyId: membership.company_id,
                actorId: createdSession.userId,
                ipAddress: createdSession.ipAddress ?? null,
                requestId: `login:${createdSession.id}`,
                action: "auth.login",
                resourceType: "session",
                resourceId: createdSession.id,
                after: { userId: createdSession.userId },
              });
            }
          },
        },
      },
    },
    advanced: {
      defaultCookieAttributes: {
        secure: baseURL.startsWith("https://"),
        sameSite: baseURL.startsWith("https://") ? "none" : "lax",
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "employee",
          input: false,
        },
      },
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
