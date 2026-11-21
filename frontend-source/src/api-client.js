import { AUTH_TOKEN_KEY, authBaseURL } from "./auth-client";

export async function apiRequest(path, { method = "GET", body } = {}) {
  const headers = new Headers();
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(new URL(path, authBaseURL), {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();
  let result = null;
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      result = null;
    }
  }

  if (!response.ok) {
    throw new Error(
      result?.error ||
        result?.message ||
        `Request failed with status ${response.status}.`,
    );
  }
  if (responseText && result === null) {
    throw new Error("The server returned an invalid response.");
  }
  return result;
}
