import * as React from "react";
import { cn } from "@/lib/utils";

/* ==========================================================================
   Kit de interface — componentes pequenos, acessíveis e sem dependências.
   ========================================================================== */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "quiet";
  size?: "sm" | "md" | "lg";
};

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90 border border-transparent",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-ink-soft hover:bg-surface-2 border border-transparent",
  danger: "bg-danger-soft text-danger border border-danger/30 hover:bg-danger/15",
  quiet: "bg-surface-2 text-ink-soft border border-transparent hover:bg-line",
};

const BUTTON_SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  className,
  variant = "secondary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/** Mesma aparência do botão, mas semanticamente um link (evita <button><a>). */
export function LinkButton({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  href: string;
}) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium",
        "transition-colors no-underline",
        BUTTON_VARIANTS[variant ?? "secondary"],
        BUTTON_SIZES[size ?? "md"],
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  as: Tag = "div",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { as?: React.ElementType }) {
  return (
    <Tag
      className={cn(
        "rounded-[var(--radius)] border border-line bg-surface",
        "shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-line px-5 py-4", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("font-serif text-lg leading-tight tracking-tight text-ink", className)}
      {...props}
    />
  );
}

export function Muted({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-ink-faint", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[13px] font-medium text-ink-soft", className)}
      {...props}
    />
  );
}

const FIELD_STYLES =
  "w-full rounded-[var(--radius)] border border-line-strong bg-surface px-3 py-2 " +
  "text-sm text-ink placeholder:text-ink-faint/70 transition-colors " +
  "focus:border-accent disabled:opacity-60";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_STYLES, "h-10", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_STYLES, "min-h-28 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(FIELD_STYLES, "h-10 pr-8", className)} {...props} />;
}

type BadgeTone =
  | "neutral"
  | "accent"
  | "speech"
  | "memory"
  | "inference"
  | "reflection"
  | "danger"
  | "success";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-soft border-line",
  accent: "bg-accent-soft text-accent border-accent/25",
  speech: "bg-speech-soft text-speech border-speech/25",
  memory: "bg-memory-soft text-memory border-memory/25",
  inference: "bg-inference-soft text-inference border-inference/25",
  reflection: "bg-reflection-soft text-reflection border-reflection/25",
  danger: "bg-danger-soft text-danger border-danger/25",
  success: "bg-success-soft text-success border-success/25",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-[11px] font-medium tracking-wide whitespace-nowrap",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="font-serif text-[28px] leading-tight tracking-tight text-ink">{title}</h1>
        {description ? <div className="mt-2 text-sm text-ink-soft">{description}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="font-serif text-lg text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-faint">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Alert({
  tone = "neutral",
  title,
  children,
}: {
  tone?: BadgeTone;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-[var(--radius)] border px-4 py-3 text-sm",
        BADGE_TONES[tone],
        "[&_strong]:font-semibold",
      )}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progresso"}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {label ? <p className="mt-1.5 text-xs text-ink-faint">{label}</p> : null}
    </div>
  );
}

/** Escala de autoridade da fonte (1 a 5). */
export function AuthorityMeter({ level }: { level: number }) {
  const labels = ["rascunho", "anotação", "reflexão aprovada", "texto autoral", "cânone"];
  const value = Math.min(5, Math.max(1, level));
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`Autoridade ${value}/5 — ${labels[value - 1]}`}
    >
      <span className="sr-only">{`Autoridade ${value} de 5: ${labels[value - 1]}`}</span>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "h-1.5 w-3 rounded-full",
            i <= value ? "bg-accent" : "bg-line-strong opacity-60",
          )}
        />
      ))}
    </span>
  );
}
