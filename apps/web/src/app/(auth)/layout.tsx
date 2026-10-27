import { type ReactNode } from 'react';

/**
 * The layout of the screens outside the panel: a centred card, with no menu
 * and no side navigation — where whoever cannot be in the panel yet lands.
 *
 * It is a shell and nothing else: it checks no session, and each page in the
 * group says what it needs. The sign-in screens need none; the first access
 * needs one and asks for it itself.
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
