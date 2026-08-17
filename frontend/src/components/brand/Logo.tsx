import { cn } from "@/lib/cn";

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg
        aria-hidden="true"
        className="h-6 w-6 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          d="M5.5 5.5h8.2a4.8 4.8 0 0 1 0 9.6H8.9"
          stroke="#66E0AC"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
        <path
          d="M5.5 9.25h7.8a1.05 1.05 0 1 1 0 2.1H8.9v7.15H5.5v-9.25Z"
          fill="#F2F5F7"
        />
      </svg>
      {!compact && (
        <span className="text-[13px] font-semibold tracking-[0.13em] text-ink">BACKPLANE</span>
      )}
    </div>
  );
}

