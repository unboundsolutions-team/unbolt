import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The only accent-filled control in the system is `primary`, and a view should
 * contain at most one. The accent is the "this is the action" signal; spending
 * it on two things at once means it signals nothing.
 *
 * `accent-ink` is the only colour permitted on top of the accent — it is the
 * one pairing the contrast gate guarantees, in every theme.
 */
const button = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-sans font-medium leading-none",
    "border border-transparent",
    "transition-[transform,background-color,border-color,color,box-shadow]",
    "duration-(--duration-fast) ease-(--ease-out-expo)",
    "active:translate-y-px",
    "disabled:pointer-events-none",
    // Radix sets data-state on trigger elements; keep the pressed look honest.
    "data-[state=open]:translate-y-px",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-accent text-accent-ink",
          "hover:bg-accent-hover active:bg-accent-pressed",
          "shadow-(--shadow-accent) hover:shadow-md",
        ],
        secondary: [
          "bg-card text-ink border-line-strong",
          "hover:bg-inset hover:border-ink-3",
          "active:bg-inset",
          "shadow-sm",
        ],
        ghost: ["bg-transparent text-ink-2", "hover:bg-inset hover:text-ink", "active:bg-line"],
        link: [
          "bg-transparent text-accent px-0 h-auto",
          "underline decoration-line-strong underline-offset-4",
          "hover:decoration-accent active:text-accent-pressed",
        ],
        danger: [
          "bg-urgent text-accent-ink",
          "hover:brightness-110 active:brightness-95",
          "shadow-sm",
        ],
        /** Quiet control on an elevated surface — cards, the queue board. */
        subtle: [
          "bg-inset text-ink border-line",
          "hover:border-accent hover:text-accent",
          "active:bg-card",
        ],
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-(--radius-sm)",
        md: "h-10 px-4 text-sm rounded-(--radius-md)",
        lg: "h-12 px-6 text-base rounded-(--radius-md)",
        icon: "size-10 p-0 rounded-(--radius-md)",
      },
      block: { true: "w-full", false: "" },
    },
    compoundVariants: [{ variant: "link", size: ["sm", "md", "lg"], class: "h-auto px-0" }],
    defaultVariants: { variant: "secondary", size: "md", block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /** Render as the single child element instead of a `<button>`. */
  asChild?: boolean;
  /** Renders a spinner and blocks interaction without changing width. */
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        button({ variant, size, block }),
        // A loading button is busy, not unavailable. It blocks interaction via
        // `disabled`, but styling it as unavailable makes it read as "you cannot
        // do this" at the exact moment the user has just done it.
        //
        // ── Why this is tokens and not opacity ────────────────────────
        // It used to fade the whole control to 45% opacity. Fading a filled button composites
        // BOTH its background and its label toward the page, and the two
        // converge: the primary button's label measured 3.92:1 in Nightshift and
        // 2.02:1 in Meridian — under AA, on a control that stays disabled for
        // the ~30 seconds a store scan takes. Raising the opacity did not fix
        // Meridian, because a near-black ink on a near-black page cannot be
        // rescued by any alpha.
        //
        // ink-3 on inset is an explicit pairing in the contrast gate and passes
        // in every theme, so this is correct by construction rather than by
        // measurement — and it looks the same on every variant, which a
        // disabled state should.
        !loading && [
          "disabled:bg-inset disabled:text-ink-3",
          "disabled:border-line disabled:shadow-none",
        ],
        className,
      )}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Spinner />
          {/* Keep the label in the a11y tree and keep the box the same width. */}
          <span className="opacity-0">{children}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

function Spinner() {
  return (
    <svg
      className="absolute size-4 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export { button as buttonVariants };
