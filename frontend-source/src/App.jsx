  import { useState } from "react";
  import { Button } from "./components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
  import { Label } from "./components/ui/label";
  import {
    InputOTP,
    InputOTPGroup,
    InputOTPSeparator,
    InputOTPSlot,
  } from "./components/ui/input-otp";
  import { z } from "zod";
  import axios from "axios";
  import { Link, useNavigate } from "react-router";
  const url =
    "https://system-payroll-api.automation-payroll.workers.dev/api/key-products/activate";

  const keySchema = z
    .string()
    .regex(/^[a-z0-9]{9}$/, "Enter all 9 characters of your activation key.")
    .transform(
      (key) => `${key.slice(0, 3)}-${key.slice(3, 6)}-${key.slice(6)}`,
    );

  const getActivationErrorMessage = (requestError) => {
      const status = requestError.response?.status;
      const serverMessage = requestError.response?.data?.message;

      if (status === 409) {
        return (
          serverMessage ||
          "This activation key may have already been used. Check the key or contact support for help."
        );
      }

      if (status === 400 || status === 404) {
        return serverMessage || "We couldn't find a valid activation key. Check it and try again.";
      }

      if (status === 401 || status === 403) {
        return "We couldn't verify this activation key right now. Please contact support.";
      }

      if (status >= 500) {
        return "The activation service is temporarily unavailable. Please try again later.";
      }

      if (serverMessage) {
        return serverMessage;
      }

      if (!requestError.response) {
        return "We couldn't connect to the activation service. Check your internet connection and try again.";
      }

      return "We couldn't activate this key. Please try again or contact support.";
  };

  export default function App() {
    const navigate = useNavigate();
    const [data, setData] = useState({ key: "" });
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (event) => {
      event.preventDefault();
      setError("");

      const result = keySchema.safeParse(data.key);
      if (!result.success) {
        setError(result.error.issues[0].message);
        return;
      }

      setIsSubmitting(true);
      try {
        await axios.post(url, { key: result.data });
        navigate("/register", {
          state: { activationKey: result.data },
        });
      } catch (requestError) {
        setError(getActivationErrorMessage(requestError));
      } finally {
        setIsSubmitting(false);
      }
    };

    const handleChange = (value) => {
      setData({ key: value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 9) });
      setError("");
    };

    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-2">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Enter Activation Key Product</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlfor="activation-key">Activation Key</Label>
                <InputOTP
                  id="activation-key"
                  maxLength={9}
                  inputMode="text"
                  value={data.key}
                  onChange={handleChange}
                  aria-label="Activation key"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "activation-key-error" : undefined}
                  disabled={isSubmitting}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={6} />
                    <InputOTPSlot index={7} />
                    <InputOTPSlot index={8} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {error && (
                <p id="activation-key-error" role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Validating…" : "Activate"}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="font-medium text-foreground underline">
                Log in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }