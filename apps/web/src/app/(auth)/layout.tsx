import { type ReactNode } from 'react';

/**
 * The layout of the sign-in screens: a centred card, with no menu and nothing
 * that needs a session — it is exactly where whoever has none lands.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <span className="text-lg font-semibold tracking-tight">fit-app</span>
          <span className="text-sm text-muted-foreground">Painel do profissional</span>
        </div>

        {children}
      </div>
    </div>
  );
}
