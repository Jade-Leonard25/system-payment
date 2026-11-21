import { createAuthClient } from "better-auth/react";

export const AUTH_TOKEN_KEY = "payroll_auth_token";
export const REGISTERED_ADMIN_KEY = "payroll_admin_registered";
export const STAY_LOGGED_IN_KEY = "payroll_stay_logged_in";

export const getStayLoggedIn = async () => {
  const savedSetting = window.localStorage.getItem(STAY_LOGGED_IN_KEY);
  const defaultSetting = savedSetting === null ? true : savedSetting === "true";
  const settings = await window.windowControls?.getSettings?.();
  return typeof settings?.stayLoggedIn === "boolean"
    ? settings.stayLoggedIn
    : defaultSetting;
};

export const setStayLoggedIn = async (enabled) => {
  await window.windowControls?.setStayLoggedIn?.(enabled);
  window.localStorage.setItem(STAY_LOGGED_IN_KEY, String(enabled));
};

export const getAdminRegistered = async () => {
  if (typeof window === "undefined") return false;

  const localMarker =
    window.localStorage.getItem(REGISTERED_ADMIN_KEY) === "true";
  const electronMarker =
    await window.windowControls?.getAdminRegistered?.();
  const isRegistered = Boolean(localMarker || electronMarker);

  if (isRegistered && !electronMarker) {
    await window.windowControls?.markAdminRegistered?.();
  }
  if (isRegistered && !localMarker) {
    window.localStorage.setItem(REGISTERED_ADMIN_KEY, "true");
  }

  return isRegistered;
};

export const markAdminRegistered = async () => {
  window.localStorage.setItem(REGISTERED_ADMIN_KEY, "true");
  await window.windowControls?.markAdminRegistered?.();
};

const productionAuthURL =
  "https://system-payroll-api.automation-payroll.workers.dev";

export const authBaseURL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV && typeof window !== "undefined"
    ? window.location.origin
    : productionAuthURL);

export const authClient = createAuthClient({
  baseURL: authBaseURL,
  fetchOptions: {
    credentials: "include",
    auth: {
      type: "Bearer",
      token: () =>
        typeof localStorage !== "undefined"
          ? (localStorage.getItem(AUTH_TOKEN_KEY) ?? undefined)
          : undefined,
    },
  },
});

export const { signIn, signOut, signUp, useSession, getSession } = authClient;
