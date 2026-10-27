'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * The last screen of the panel: what renders when a React error escapes every
 * boundary above it. It replaces the whole document, which is why it carries
 * `<html>` and `<body>` of its own.
 *
 * It is also where a browser error gets reported (ADR 0013): a crash during
 * render never reaches `window.onerror`, so without this file it would leave
 * no trace in Sentry.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="flex min-h-svh items-center justify-center p-8">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-lg font-semibold">Algo não funcionou aqui</h1>

          <p className="text-sm text-neutral-400">
            A falha foi registrada e já estamos sabendo. Atualize a página; se continuar, avise o
            suporte.
          </p>

          {/*
            The digest and nothing else. It is the id Next.js gives the error
            on the server, and it is what lets support find it — unlike the
            message, which can quote what broke (`CLAUDE.md`, "Saúde e LGPD").
          */}
          {error.digest !== undefined && (
            <p className="font-mono text-xs text-neutral-500">{error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
