"use client";

import { createContext, startTransition, useActionState, useContext, useId } from "react";

import type { ActionState } from "./actions";

/**
 * Small form kit for the admin panel. Server pages compose these client
 * components around a Server Action; validation errors returned by the
 * action reach each field through context, next to its input.
 */

const FormStateContext = createContext<ActionState & { pending?: boolean }>({});

export function ActionForm({
  action,
  children,
  className = "grid gap-4",
  resetOnSuccess = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <FormStateContext.Provider value={{ ...state, pending }}>
      <form
        action={formAction}
        className={className}
        // React resets a form after its action runs, even when validation
        // failed. Submitting inside our own transition keeps what the user
        // typed; `key` remounts (clears) the form only after a success.
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(
            event.currentTarget,
            (event.nativeEvent as SubmitEvent).submitter,
          );
          startTransition(() => formAction(formData));
        }}
        key={resetOnSuccess && state.ok ? JSON.stringify(state) : undefined}
      >
        {children}
        <FormMessage />
      </form>
    </FormStateContext.Provider>
  );
}

function FormMessage() {
  const state = useContext(FormStateContext);
  if (!state.message && !state.errors?._form) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-sm ${state.ok ? "text-emerald-300" : "text-red-300"}`}
    >
      {state.message ?? state.errors?._form}
    </p>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  variant = "primary",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  name?: string;
  value?: string;
}) {
  const { pending } = useContext(FormStateContext);
  const styles = {
    primary:
      "bg-foreground text-background border-foreground hover:bg-background hover:text-foreground",
    secondary: "border-foreground hover:bg-foreground hover:text-background",
    danger: "border-red-400/60 text-red-200 hover:bg-red-400/10",
  }[variant];
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`border px-5 py-2.5 text-xs tracking-[0.2em] uppercase transition-colors disabled:opacity-50 ${styles}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function Input({
  label,
  name,
  hint,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; hint?: string }) {
  const id = useId();
  const error = useContext(FormStateContext).errors?.[name];
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-muted text-xs tracking-[0.15em] uppercase">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-help` : undefined}
        className="border-border bg-surface focus:border-foreground border px-3 py-2 [color-scheme:dark] outline-none aria-invalid:border-red-400"
        {...props}
      />
      {(error || hint) && (
        <p id={`${id}-help`} className={`text-xs ${error ? "text-red-300" : "text-muted"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Select({
  label,
  name,
  children,
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; name: string }) {
  const id = useId();
  const error = useContext(FormStateContext).errors?.[name];
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-muted text-xs tracking-[0.15em] uppercase">
        {label}
      </label>
      <select
        id={id}
        name={name}
        aria-invalid={Boolean(error)}
        className="border-border bg-surface focus:border-foreground border px-3 py-2 [color-scheme:dark] outline-none"
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

export function Checkbox({
  label,
  name,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} className="accent-white" {...props} />
      {label}
    </label>
  );
}
