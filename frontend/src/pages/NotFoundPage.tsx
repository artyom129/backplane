import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/Button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center p-6 text-center">
      <div>
        <div className="font-mono text-xs text-accent">HTTP 404</div>
        <h1 className="mt-3 text-2xl font-medium text-ink">This control surface does not exist.</h1>
        <p className="mt-2 text-sm text-muted">The route may have moved or the resource is no longer available.</p>
        <Link to="/">
          <Button className="mt-5" variant="secondary">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to overview
          </Button>
        </Link>
      </div>
    </div>
  );
}

