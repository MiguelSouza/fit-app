import { type Metadata } from 'next';
import { type ReactNode } from 'react';

import './globals.css';

/**
 * `title.template` applies to every page that sets a `title` of its own, so each
 * route says only its own name ("Fila") and the suffix comes from here.
 */
export const metadata: Metadata = {
  title: {
    default: 'fit-app',
    template: '%s · fit-app',
  },
  description: 'Painel do profissional: prescrição da dieta e acompanhamento do paciente.',
};

/**
 * The root layout. The only place with `<html>` and `<body>`, and deliberately
 * nothing else: the session, the side menu and the API client belong to the
 * route group of the panel (`(painel)/layout.tsx`), and the sign-in screens
 * (`(auth)/layout.tsx`) have none of them.
 *
 * `lang="pt-BR"` is what a screen reader and the browser spell checker read. The
 * language starts coming from the request when the panel gets real i18n; until
 * then the interface is in Portuguese, as `CLAUDE.md` requires.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-svh">{children}</body>
    </html>
  );
}
