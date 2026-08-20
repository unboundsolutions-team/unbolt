"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/**
 * Field wires the label, hint and error to the control by id so a screen reader
 * announces all three. Nothing here relies on placeholder text as a label — a
 * placeholder disappears the moment the user types, which is exactly when they
 * need the label most.
 */

const controlBase = [
  "w-full bg-card text-ink font-sans text-sm",
  "border border-line-strong rounded-(--radius-md)",
  "placeholder:text-ink-3",
  "transition-[border-color,background-color,box-shadow]",
  "duration-(--duration-fast) ease-(--ease-out-expo)",
  "hover:border-ink-3",
  "focus:border-accent focus:bg-inset",
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-inset",
  "aria-[invalid=true]:border-urgent",
].join(" ");

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Hide the label visually but keep it for assistive tech. */
  hideLabel?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  hideLabel = false,
  className,
  children,
}: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <LabelPrimitive.Root
        htmlFor={id}
        className={cn(
          "font-sans text-sm font-medium text-ink",
          hideLabel && "sr-only",
        )}
      >
        {label}
        {required ? (
          <span className="text-urgent ml-0.5" aria-hidden="true">
            *
          </span>
        ) : null}
      </LabelPrimitive.Root>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {hint && !error ? (
        <p id={hintId} className="font-sans text-xs leading-[1.5] text-ink-3">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p
          id={errorId}
          className="font-sans text-xs leading-[1.5] text-urgent"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  containerClassName?: string;
}

export function Input({
  label,
  hint,
  error,
  hideLabel,
  required,
  className,
  containerClassName,
  ...props
}: InputProps) {
  return (
    <Field
      label={label}
      {...(hint !== undefined ? { hint } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(hideLabel !== undefined ? { hideLabel } : {})}
      {...(required !== undefined ? { required } : {})}
      {...(containerClassName !== undefined ? { className: containerClassName } : {})}
    >
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          className={cn(controlBase, "h-10 px-3", className)}
          {...props}
        />
      )}
    </Field>
  );
}

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  containerClassName?: string;
}

export function Textarea({
  label,
  hint,
  error,
  hideLabel,
  required,
  className,
  containerClassName,
  rows = 4,
  ...props
}: TextareaProps) {
  return (
    <Field
      label={label}
      {...(hint !== undefined ? { hint } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(hideLabel !== undefined ? { hideLabel } : {})}
      {...(required !== undefined ? { required } : {})}
      {...(containerClassName !== undefined ? { className: containerClassName } : {})}
    >
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          className={cn(controlBase, "resize-y px-3 py-2.5 leading-[1.6]", className)}
          {...props}
        />
      )}
    </Field>
  );
}

export { controlBase as fieldControlClasses };
