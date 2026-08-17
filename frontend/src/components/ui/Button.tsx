import { LoaderCircle } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    "border-accent/70 bg-accent text-[#08120e] hover:border-accent hover:bg-[#79e8b9] disabled:bg-accent/50",
  secondary: "border-line bg-raised text-ink hover:border-[#39424d] hover:bg-[#151a20]",
  ghost: "border-transparent bg-transparent text-muted hover:bg-white/[0.04] hover:text-ink",
  danger: "border-danger/40 bg-danger/10 text-danger hover:bg-danger/15 hover:border-danger/60",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-[38px] px-3.5 text-sm",
  icon: "h-8 w-8 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-[7px] border font-medium transition duration-180 disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
});

