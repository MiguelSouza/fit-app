import { type Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SentryCheckButton } from '@/components/debug/sentry-check-button';
import { SectionHeader } from '@/components/painel/section';
import { SENTRY_CHECK_MESSAGE } from '@/lib/sentry';

export const metadata: Metadata = { title: 'Sentry' };

/**
 * Provokes an error on purpose, which is the acceptance criterion of card F-16
 * ("um erro provocado em cada app aparece no Sentry") made reproducible
 * instead of being a `throw` somebody adds by hand and forgets to take back
 * out.
 *
 * **It only exists in development.** In any build with `NODE_ENV=production` —
 * which is every deploy, preview included — it answers 404, because a page
 * that crashes the panel has no business in front of a professional in the
 * middle of a consultation.
 *
 * Two halves, because they take different paths to Sentry: `?lado=servidor`
 * throws while the server renders (reported by `onRequestError`, in
 * `instrumentation.ts`), and the button throws in the browser.
 *
 * It lives inside `(painel)` so that it is born behind the session, like every
 * other route of the group — nothing was added to the public list in
 * `routes.ts`.
 */
export default async function SentryCheckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();

  if ((await searchParams).lado === 'servidor') throw new Error(SENTRY_CHECK_MESSAGE);

  return (
    <>
      <SectionHeader
        title="Conferir o Sentry"
        description="Página só de desenvolvimento: provoca um erro para ver se ele chega ao projeto — e se chega sem dado de ninguém."
      />

      <div className="flex flex-col items-start gap-3">
        <SentryCheckButton />

        <a className="text-sm underline underline-offset-4" href="?lado=servidor">
          Provocar um erro no servidor
        </a>

        <p className="max-w-prose text-sm text-muted-foreground">
          O erro leva nome, e-mail e peso sintéticos na mensagem. Na issue do Sentry os três
          precisam aparecer como <code>[redacted]</code>, e o usuário, só como id.
        </p>
      </div>
    </>
  );
}
