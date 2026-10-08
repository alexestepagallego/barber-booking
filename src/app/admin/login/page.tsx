import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { Monogram } from "@/components/monogram";
import { isDemoMode } from "@/server/config";

import { login } from "../actions";
import { ActionForm, Input, SubmitButton } from "../ui";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <Monogram />
        <h1 className="font-display text-3xl italic">Staff sign in</h1>
      </div>
      <ActionForm action={login}>
        <Input label="Email" name="email" type="email" autoComplete="username" required />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <Suspense>
        <DemoCredentials />
      </Suspense>
    </main>
  );
}

/** In the public demo, show the throwaway credentials so visitors can try the panel. */
async function DemoCredentials() {
  await connection();
  if (!isDemoMode()) return null;
  return (
    <p className="border-border text-muted border p-4 text-center text-sm">
      Demo access: <strong className="text-foreground">{process.env.DEMO_ADMIN_EMAIL}</strong> /{" "}
      <strong className="text-foreground">{process.env.DEMO_ADMIN_PASSWORD}</strong>
      <br />
      Data resets every night.
    </p>
  );
}
