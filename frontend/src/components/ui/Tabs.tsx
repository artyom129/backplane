import { cn } from "@/lib/cn";

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange(value: T): void;
  items: Array<{ value: T; label: string; count?: number }>;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-0.5 border-b border-line", className)} role="tablist">
      {items.map((item) => (
        <button
          className={cn(
            "relative px-3 py-2.5 text-xs font-medium text-muted hover:text-ink",
            item.value === value && "text-ink after:absolute after:inset-x-2 after:bottom-[-1px] after:h-px after:bg-accent",
          )}
          key={item.value}
          onClick={() => onChange(item.value)}
          role="tab"
          type="button"
        >
          {item.label}
          {item.count !== undefined && <span className="ml-1.5 text-[10px] text-muted">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

