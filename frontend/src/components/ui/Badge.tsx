import { cn } from "@/lib/cn";
import type { StatusTone } from "@/types";

const tones: Record<StatusTone, string> = {
  success: "border-accent/25 bg-accent/[0.08] text-accent",
  error: "border-danger/25 bg-danger/[0.08] text-danger",
  warning: "border-warning/25 bg-warning/[0.08] text-warning",
  info: "border-sky-400/25 bg-sky-400/[0.08] text-sky-300",
  neutral: "border-line bg-white/[0.025] text-muted",
};

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  if (["success", "completed", "delivered", "verified", "operational", "resolved"].includes(status)) {
    return "success";
  }
  if (["error", "failed", "dead_letter", "invalid", "critical", "open"].includes(status)) {
    return "error";
  }
  if (["warning", "retrying", "degraded", "high", "investigating"].includes(status)) {
    return "warning";
  }
  if (["running", "queued", "pending"].includes(status)) return "info";
  return "neutral";
}

export function Badge({
  children,
  tone,
  dot = false,
  className,
}: {
  children: React.ReactNode;
  tone?: StatusTone;
  dot?: boolean;
  className?: string;
}) {
  const resolvedTone = tone ?? statusTone(String(children).toLowerCase());
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium capitalize",
        tones[resolvedTone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

