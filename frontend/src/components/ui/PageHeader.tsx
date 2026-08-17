import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

export function PageHeader({
  title,
  description,
  action,
  breadcrumbs,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  breadcrumbs?: Array<{ label: string; to?: string }>;
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && (
        <nav className="mb-3 flex items-center gap-1 text-[11px] text-muted" aria-label="Breadcrumb">
          {breadcrumbs.map((item, index) => (
            <span className="flex items-center gap-1" key={`${item.label}-${index}`}>
              {index > 0 && <ChevronRight className="h-3 w-3 text-muted/50" />}
              {item.to ? (
                <Link className="hover:text-ink" to={item.to}>
                  {item.label}
                </Link>
              ) : (
                <span>{item.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-medium tracking-[-0.025em] text-ink">{title}</h1>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

