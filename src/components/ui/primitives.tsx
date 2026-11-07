import * as React from "react";
import { cn } from "@/lib/utils/format";

/* ───────────────────────── Button ───────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "up" | "down";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent/85 font-medium",
  secondary: "bg-surface-3 text-fg border border-border-strong hover:bg-border-strong",
  ghost: "text-muted hover:text-fg hover:bg-surface-3",
  danger: "bg-down/15 text-down border border-down/30 hover:bg-down/25",
  // Dark text on the bright dark-theme colors; white on the deeper light-theme colors (≥ 4.5:1 both ways).
  up: "bg-up text-[#04140d] light:text-white hover:bg-up/85 font-medium",
  down: "bg-down text-[#1a0505] light:text-white hover:bg-down/85 font-medium",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-[0.8125rem] gap-2",
  lg: "h-10 px-4 text-sm gap-2",
  icon: "h-8 w-8 justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center rounded-md transition-colors duration-150 select-none whitespace-nowrap",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ───────────────────────── Panel ───────────────────────── */

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("rounded-lg border border-border bg-surface", className)} {...props} />;
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-3 border-b border-border px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[0.8125rem] font-semibold tracking-tight text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

/* ───────────────────────── Badge ───────────────────────── */

type BadgeTone = "neutral" | "up" | "down" | "accent" | "warn" | "info";

const badgeTone: Record<BadgeTone, string> = {
  neutral: "bg-surface-3 text-muted border-border-strong",
  up: "bg-up/10 text-up border-up/25",
  down: "bg-down/10 text-down border-down/25",
  accent: "bg-accent/10 text-accent border-accent/25",
  warn: "bg-warn/10 text-warn border-warn/30",
  info: "bg-info/10 text-info border-info/25",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[0.6875rem] font-medium leading-4 whitespace-nowrap",
        badgeTone[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ───────────────────────── Form fields ───────────────────────── */

const fieldBase =
  "w-full rounded-md border border-border-strong bg-bg px-2.5 text-[0.8125rem] text-fg placeholder:text-faint " +
  "transition-colors focus:border-accent/60 focus:outline-none disabled:opacity-60 aria-[invalid=true]:border-down/60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldBase, "h-8", className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(fieldBase, "h-8 cursor-pointer pr-7", className)} {...props}>
        {children}
      </select>
    );
  },
);

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-down" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

/* ───────────────────────── Feedback ───────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse-soft rounded-sm bg-surface-3", className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      {icon ? <div className="mb-1 text-faint">{icon}</div> : null}
      <p className="text-[0.8125rem] font-medium text-fg">{title}</p>
      {description ? <p className="max-w-sm text-xs leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warn" | "down" | "up";
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const toneClass = {
    info: "border-info/25 bg-info/5 text-info",
    warn: "border-warn/30 bg-warn/5 text-warn",
    down: "border-down/30 bg-down/5 text-down",
    up: "border-up/25 bg-up/5 text-up",
  }[tone];
  return (
    <div role={tone === "down" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-xs", toneClass, className)}>
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cn("leading-relaxed text-fg/80", title && "mt-0.5")}>{children}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-sm border border-border-strong bg-surface-3 px-1 font-mono text-[0.625rem] text-muted">
      {children}
    </kbd>
  );
}
