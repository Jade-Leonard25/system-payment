import type { Context, MiddlewareHandler } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { createAuth } from "../auth";

type Bindings = { DB: D1Database };
type PermissionEnv = {
  Bindings: Bindings;
  Variables: {
    permissionAccess: {
      userId: string;
      role: string;
      companyId: string;
    };
  };
};

export async function requireUser<
  Environment extends { Bindings: Bindings },
>(c: Context<Environment>) {
  const auth = createAuth(c.env.DB, new URL(c.req.url).origin);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return { response: c.json({ error: "Authentication required" }, 401) };
  }
  return { userId: session.user.id, role: session.user.role };
}

export async function requireAdmin<
  Environment extends { Bindings: Bindings },
>(c: Context<Environment>) {
  const access = await requireUser(c);
  if ("response" in access) return access;
  if (access.role !== "admin") {
    return { response: c.json({ error: "Administrator access required" }, 403) };
  }
  return access;
}

export async function checkCompanyPermission(
  database: D1Database,
  userId: string,
  companyId: string,
  permissionKey: string,
): Promise<{ member: boolean; allowed: boolean; role?: string }> {
  const membership = await database
    .prepare(
      `SELECT role
       FROM company_memberships
       WHERE company_id = ? AND user_id = ?
       LIMIT 1`,
    )
    .bind(companyId, userId)
    .first<{ role: string }>();
  if (!membership) return { member: false, allowed: false };

  const grant = await database
    .prepare(
      `SELECT 1 AS allowed
       FROM role_permissions AS rp
       JOIN permissions AS p
         ON p.company_id = rp.company_id
        AND p.permission_key = rp.permission_key
       WHERE rp.company_id = ? AND rp.role = ? AND rp.permission_key = ?
       LIMIT 1`,
    )
    .bind(companyId, membership.role, permissionKey)
    .first<{ allowed: number }>();
  return {
    member: true,
    allowed: Boolean(grant),
    role: membership.role,
  };
}

export function requirePermission(
  permissionKey: string,
): MiddlewareHandler<PermissionEnv> {
  return async (c, next) => {
    const companyId = c.req.query("companyId") ?? "";
    if (!companyId) {
      return c.json({ error: "Company ID is required" }, 400);
    }
    const access = await requireUser(c);
    if ("response" in access) return access.response;

    const permission = await checkCompanyPermission(
      c.env.DB,
      access.userId,
      companyId,
      permissionKey,
    );
    if (!permission.member) {
      return c.json({ error: "Company not found" }, 404);
    }
    if (!permission.allowed) {
      return c.json({ error: "Permission denied" }, 403);
    }
    c.set("permissionAccess", {
      userId: access.userId,
      role: permission.role ?? "",
      companyId,
    });
    await next();
  };
}
