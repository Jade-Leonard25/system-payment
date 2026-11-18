// frontend/src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "http://localhost:8787", // Your Hono worker URL
});

// Inside your Login Component:
// const { data, error } = await authClient.signIn.email({
//   email: "admin@example.com",
//   password: "yourpassword",
// });
