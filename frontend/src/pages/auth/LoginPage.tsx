import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/Form";
import { ApiError } from "@/lib/api";
import { AuthLayout } from "@/pages/auth/AuthLayout";
import { useAuth } from "@/providers/AuthProvider";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("demo@backplane.dev");
  const [password, setPassword] = useState("backplane-demo");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate replace to="/" />;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-7">
        <div className="eyebrow mb-3">Secure workspace access</div>
        <h1 className="text-2xl font-medium tracking-[-0.03em] text-ink">Welcome back</h1>
        <p className="mt-2 text-sm text-muted">Sign in to continue to your operations workspace.</p>
      </div>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <FormField label="Email address">
          <Input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </FormField>
        <FormField label="Password">
          <Input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </FormField>
        {error && (
          <div className="rounded-[7px] border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-xs text-danger">
            {error}
          </div>
        )}
        <Button className="w-full" loading={submitting} type="submit" variant="primary">
          Sign in <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </form>
      <div className="mt-6 rounded-[7px] border border-line bg-surface px-3 py-2.5 font-mono text-[10px] leading-5 text-muted">
        Demo credentials are prefilled after running <span className="text-[#c9d0d6]">make seed</span>.
      </div>
      <p className="mt-6 text-center text-xs text-muted">
        New to BACKPLANE?{" "}
        <Link className="font-medium text-accent hover:text-[#82ebbe]" to="/register">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
