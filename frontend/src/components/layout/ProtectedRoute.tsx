import { Navigate } from "react-router-dom";

import { Logo } from "@/components/brand/Logo";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/providers/AuthProvider";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-52 text-center">
          <Logo className="mb-5 justify-center" />
          <Skeleton className="mx-auto h-1 w-32" />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate replace to="/login" />;
  return children;
}

