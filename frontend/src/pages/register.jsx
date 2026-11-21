import { useState } from "react";
import axios from "axios";
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
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const registerAdminURL =
  "https://system-payroll-api.automation-payroll.workers.dev/api/key-products/register-admin";

const registrationSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your name."),
    email: z.string().trim().email("Enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export default function Register() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const activationKey = state?.activationKey;
  const [data, setData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!activationKey) {
      setError("Activate a product key before creating an account.");
      return;
    }

    const result = registrationSchema.safeParse(data);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    setIsSubmitting(true);
    let accountCreated = false;
    try {
      await axios.post(registerAdminURL, {
        key: activationKey,
        name: result.data.name,
        email: result.data.email,
        password: result.data.password,
      });
      accountCreated = true;
      await markAdminRegistered();

      const rememberMe = await getStayLoggedIn();
      const signInResult = await signIn.email({
        email: result.data.email,
        password: result.data.password,
        rememberMe,
      });

      if (signInResult.error) {
        navigate("/login", {
          replace: true,
          state: {
            registrationCompleted: true,
            message:
              "Your account was created, but automatic login didn't work. Log in with your new account to continue.",
          },
        });
        return;
      }

      navigate("/dashboard", { replace: true });
    } catch (requestError) {
      if (accountCreated) {
        navigate("/login", {
          replace: true,
          state: {
            registrationCompleted: true,
            message:
              "Your account was created, but automatic login didn't work. Log in with your new account to continue.",
          },
        });
        return;
      }

      const status = requestError.response?.status;
      const serverMessage =
        requestError.response?.data?.message ||
        requestError.response?.data?.error;

      if (serverMessage) {
        setError(serverMessage);
      } else if (status === 409) {
        setError(
          "This activation key may already be registered, or this email is already in use. Check the details or contact support.",
        );
      } else if (status === 400 || status === 422) {
        setError("Some registration details are invalid. Check them and try again.");
      } else if (status === 401 || status === 403) {
        setError("This activation key cannot be used to register. Activate a valid key and try again.");
      } else if (status >= 500) {
        setError("Registration is temporarily unavailable. Please try again later.");
      } else if (!requestError.response) {
        setError("Could not connect to the registration service. Check your connection and try again.");
      } else {
        setError("We couldn't create your account. Please try again or contact support.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setData((current) => ({ ...current, [name]: value }));
    setError("");
  };

  if (!activationKey) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-2">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Activate a product key first</CardTitle>
          </CardHeader>
          <CardContent>
            <Link to="/" className="text-sm underline">
              Return to activation
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-2 bg-gray-200">
      <div>
        <p className="h2 font-bold text-2xl pt-4 pb-4 text-center">Congratulation's for activating your account.</p>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            Create your admin user to use this application all products is all your's.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlfor="name">Name</Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                value={data.name}
                onChange={handleChange}
                disabled={isSubmitting}
                required
              />
            </div>
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
                autoComplete="new-password"
                minLength={8}
                value={data.password}
                onChange={handleChange}
                disabled={isSubmitting}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlfor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={data.confirmPassword}
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
              {isSubmitting ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </CardContent>
      </Card>
      </div>
    </main>
  );
}
