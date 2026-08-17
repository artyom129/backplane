import { cn } from "@/lib/cn";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("panel", className)}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex min-h-14 items-center justify-between gap-4 border-b border-line px-4", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {description && <p className="mt-0.5 truncate text-xs text-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}

