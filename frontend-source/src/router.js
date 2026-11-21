import { createElement, useEffect, useState } from "react";
import {
  createBrowserRouter,
  createHashRouter,
  Navigate,
  Outlet,
  useLocation,
} from "react-router";
import { getAdminRegistered, signOut, useSession } from "./auth-client";
import App from "./App";
import WindowTitleBar from "./components/window-title-bar";
import Dashboard from "./pages/dashboard";
import Login from "./pages/login";
import Register from "./pages/register";

const RootLayout = () => {
  const { data: session, isPending, error } = useSession();
  const location = useLocation();
  const [hasRegisteredAdmin, setHasRegisteredAdmin] = useState(null);
  const [registrationCheckError, setRegistrationCheckError] = useState(false);
  const [closeError, setCloseError] = useState("");

  useEffect(() => {
    let active = true;
    getAdminRegistered()
      .then((isRegistered) => {
        if (active) setHasRegisteredAdmin(isRegistered);
      })
      .catch(() => {
        if (active) setRegistrationCheckError(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const controls = window.windowControls;
    if (!controls?.onPrepareClose) return undefined;

    const removePrepareListener = controls.onPrepareClose(async () => {
      try {
        if (session?.user) {
          const result = await signOut();
          if (result.error) {
            controls.closeFailed(
              result.error.message || "Could not log out before closing.",
            );
            return;
          }
        }

        controls.closeReady();
      } catch (closeRequestError) {
        controls.closeFailed(
          closeRequestError instanceof Error
            ? closeRequestError.message
            : "Could not log out before closing.",
        );
      }
    });
    const removeCloseFailedListener = controls.onCloseFailed((message) => {
      setCloseError(message || "Could not log out before closing the app.");
    });

    return () => {
      removePrepareListener?.();
      removeCloseFailedListener?.();
    };
  }, [session?.user]);

  if (isPending || hasRegisteredAdmin === null) {
    return createElement(
      "div",
      {
        className: "flex h-svh min-h-0 flex-col overflow-hidden",
        style: { "--app-titlebar-offset": "2.25rem" },
      },
      createElement(WindowTitleBar),
      createElement(
        "main",
        { className: "flex flex-1 items-center justify-center" },
        "Checking your account…",
      ),
    );
  }

  if (error || registrationCheckError) {
    return createElement(
      "div",
      {
        className: "flex h-svh min-h-0 flex-col overflow-hidden",
        style: { "--app-titlebar-offset": "2.25rem" },
      },
      createElement(WindowTitleBar),
      createElement(
        "main",
        {
          className: "flex flex-1 items-center justify-center",
          role: "alert",
        },
        "We could not check your login status. Please restart the app and try again.",
      ),
    );
  }

  const isLoggedIn = Boolean(session?.user);
  const isPublicEntry = ["/", "/login", "/activate", "/register"].includes(
    location.pathname,
  );

  if (isLoggedIn && isPublicEntry) {
    return createElement(Navigate, { to: "/dashboard", replace: true });
  }

  if (!isLoggedIn && location.pathname === "/") {
    return createElement(Navigate, { to: "/login", replace: true });
  }

  if (!isLoggedIn && location.pathname === "/activate" && hasRegisteredAdmin) {
    return createElement(Navigate, { to: "/login", replace: true });
  }

  if (
    !isLoggedIn &&
    ["/dashboard", "/createEmployees"].includes(location.pathname)
  ) {
    return createElement(Navigate, {
      to: "/login",
      replace: true,
      state: { from: location },
    });
  }

  return createElement(
    "div",
    {
      className: "flex h-svh min-h-0 flex-col overflow-hidden",
      style: { "--app-titlebar-offset": "2.25rem" },
    },
    createElement(WindowTitleBar),
    createElement(
      "div",
      { className: "relative min-h-0 flex-1 overflow-hidden" },
      closeError &&
        createElement(
          "p",
          {
            role: "alert",
            className:
              "fixed right-4 top-12 z-[100] max-w-md rounded-lg border bg-background p-4 text-sm shadow",
          },
          closeError,
        ),
      createElement(Outlet),
    ),
  );
};

const routes = [
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: Login },
      { path: "login", Component: Login },
      { path: "activate", Component: App },
      { path: "register", Component: Register },
      { path: "dashboard", Component: Dashboard },
      {
        path: "createEmployees",
        lazy: async () => ({
          Component: (await import("./pages/createEmployees")).default,
        }),
      },
    ],
  },
];

const router =
  typeof window !== "undefined" && window.location.protocol === "file:"
    ? createHashRouter(routes)
    : createBrowserRouter(routes);

export default router;
