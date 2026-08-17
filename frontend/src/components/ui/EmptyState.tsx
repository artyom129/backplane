import { Inbox } from "lucide-react";

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "px-5 py-8 text-center" : "px-6 py-16 text-center"}>
      <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted">
        <Inbox className="h-4 w-4" />
      </div>
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

