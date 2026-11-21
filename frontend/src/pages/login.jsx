import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import {
  getStayLoggedIn,
  markAdminRegistered,
  signIn,
} from "../auth-client";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setData((current) => ({ ...current, [name]: value }));
    setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const result = loginSchema.safeParse(data);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    setIsSubmitting(true);
    try {
      const rememberMe = await getStayLoggedIn();
      const response = await signIn.email({
        ...result.data,
        rememberMe,
      });
      if (response.error) {
        setError(
          response.error.message ||
            "We couldn't log you in. Check your details and try again.",
        );
        return;
      }

      await markAdminRegistered();
      const requestedPath = location.state?.from?.pathname;
      const destination =
        typeof requestedPath === "string" &&
        requestedPath !== "/login" &&
        requestedPath !== "/"
          ? requestedPath
          : "/dashboard";
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "We couldn't log you in. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-200 px-4 py-2">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Log in to your account</CardTitle>
        </CardHeader>
        <CardContent>
          {location.state?.registrationCompleted && (
            <p role="status" className="mb-4 text-sm text-green-700">
              {location.state.message ||
                "Your account was created. Log in to continue."}
            </p>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlfor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={data.email}
                onChange={handleChange}
                disabled={isSubmitting}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlfor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={data.password}
                onChange={handleChange}
                disabled={isSubmitting}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Logging in…" : "Log in"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Need an account?{" "}
            <Link to="/activate" className="font-medium text-foreground underline">
              Activate a product key
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
