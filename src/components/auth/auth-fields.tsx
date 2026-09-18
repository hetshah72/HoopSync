"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/**
 * Field primitives shared by the sign-in and sign-up forms, so the two render
 * identical inputs, identical error placement, and identical autofill hints.
 *
 * The inputs are deliberately taller and rounder than the app's default
 * `Input` (which is sized for dense screens like Train and Progress): these
 * are the first four controls anyone touches, usually one-handed on a phone,
 * where a 44px target is the accessibility floor rather than a style choice.
 */

const FIELD_CLASS =
  // `bg-card` (white), not `bg-background` (the off-white canvas): the design
  // system gets its depth from a lifted surface plus a hairline, and the ember
  // focus ring is the system's, not a local one.
  "h-11 rounded-xl border-border bg-card px-3.5 text-[0.95rem] shadow-xs transition-[color,box-shadow,border-color] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/25";

type FieldProps = React.ComponentProps<"input"> & {
  id: string;
  label: string;
  /** The validation message for this field, if it currently has one. */
  error?: string;
  /** Always-visible guidance (e.g. the password rules), shown until an
   * error replaces it - two messages under one input is noise. */
  hint?: string;
};

export function AuthField({
  id,
  label,
  error,
  hint,
  className,
  ...props
}: FieldProps) {
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(FIELD_CLASS, className)}
        {...props}
      />
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

/**
 * A password input with a show/hide toggle.
 *
 * Worth the extra control on this form specifically: the audience is mostly
 * on phones, and sign-up asks them to type the same 8+ character password
 * twice with no way to see either one.
 */
export function PasswordField({
  id,
  label,
  error,
  hint,
  className,
  ...props
}: FieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={cn(FIELD_CLASS, "pr-11", className)}
          {...props}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute inset-y-0 right-1.5 my-auto rounded-lg text-muted-foreground hover:text-foreground"
          // The label says what the control *does*, not what it shows, and
          // `aria-pressed` carries the current state - a screen reader user
          // gets both without the name changing under them mid-interaction.
          aria-label="Show password"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      </div>
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor} className="text-[0.8rem] font-medium">
      {children}
    </Label>
  );
}

function describedBy(id: string, error?: string, hint?: string) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

function FieldMessage({
  id,
  error,
  hint,
}: {
  id: string;
  error?: string;
  hint?: string;
}) {
  if (error) {
    return (
      <p
        id={`${id}-error`}
        role="alert"
        className="text-[0.8rem] leading-snug text-destructive"
      >
        {error}
      </p>
    );
  }
  if (hint) {
    return (
      <p
        id={`${id}-hint`}
        className="text-[0.75rem] leading-snug text-muted-foreground"
      >
        {hint}
      </p>
    );
  }
  return null;
}

/** A whole-form failure - one that belongs to no single field. */
export function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3.5 py-3 text-[0.8rem] leading-snug text-destructive"
    >
      {message}
    </p>
  );
}

/** The form's primary action - the accent colour appears only here. */
export function AuthSubmitButton({
  pending,
  pendingLabel,
  children,
}: {
  pending: boolean;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="submit"
      disabled={pending}
      // `--brand-strong` is the ember role meant for a filled surface that
      // carries text, and it pairs with `--brand-foreground` for contrast in
      // both themes - see the accent note in globals.css.
      className="h-11 w-full rounded-xl bg-brand-strong text-[0.95rem] font-semibold text-brand-foreground shadow-lg transition-all hover:bg-brand-strong/90 disabled:shadow-none"
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
