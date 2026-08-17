import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { FormField, Input } from "@/components/ui/Form";
import { ApiError } from "@/lib/api";
import { AuthLayout } from "@/pages/auth/AuthLayout";
import { useAuth } from "@/providers/AuthProvider";

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    organization_name: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate replace to="/" />;
  const update = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register(form);
      navigate("/");
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Unable to create account.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-7">
        <div className="eyebrow mb-3">Start an operations workspace</div>
        <h1 className="text-2xl font-medium tracking-[-0.03em] text-ink">Create your account</h1>
        <p className="mt-2 text-sm text-muted">A private organization will be created with you as owner.</p>
      </div>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Your name">
            <Input autoComplete="name" onChange={update("full_name")} required value={form.full_name} />
          </FormField>
          <FormField label="Organization">
            <Input onChange={update("organization_name")} required value={form.organization_name} />
          </FormField>
        </div>
        <FormField label="Work email">
          <Input autoComplete="email" onChange={update("email")} required type="email" value={form.email} />
        </FormField>
        <FormField label="Password" hint="Use at least 10 characters.">
          <Input
            autoComplete="new-password"
            minLength={10}
            onChange={update("password")}
            required
            type="password"
            value={form.password}
          />
        </FormField>
        {error && (
          <div className="rounded-[7px] border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-xs text-danger">
            {error}
          </div>
        )}
        <Button className="w-full" loading={submitting} type="submit" variant="primary">
          Create workspace <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-muted">
        Already have an account?{" "}
        <Link className="font-medium text-accent hover:text-[#82ebbe]" to="/login">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

