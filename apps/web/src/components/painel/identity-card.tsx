'use client';

import { type PersonRole } from '@fit-app/api-client';
import { useQuery } from '@tanstack/react-query';

import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { meQuery } from '@/lib/api/me';

const ROLE_LABELS: Record<PersonRole, string> = {
  professional: 'Profissional',
  patient: 'Paciente',
};

/**
 * Who is using the panel, according to the API.
 *
 * It is `GET /v1/me` end to end, which is what card F-13 asks to prove: the
 * Supabase session becomes an `Authorization: Bearer` in the generated client,
 * the API validates the token and answers the contract, and what it answered
 * shows up here.
 *
 * The **name** is not among these fields, and that is not an oversight:
 * `MeResponse` answers id, role and time zone, and name and e-mail are personal
 * data that come with the profile endpoint of the `identity` module — the one
 * that logs the access (`packages/contracts/src/identity/me.ts`). When that
 * endpoint exists, this is where the name goes.
 */
export function IdentityCard() {
  const { data, error, isPending } = useQuery(meQuery);

  return (
    <Card aria-busy={isPending}>
      <CardHeader>
        <CardTitle>Sua conta</CardTitle>
        <CardDescription>O que a API responde em GET /v1/me.</CardDescription>
      </CardHeader>

      <CardContent>
        {isPending ? <IdentitySkeleton /> : null}

        {error != null ? (
          <Alert variant="destructive">
            Não foi possível falar com a API agora. Recarregue a página em instantes.
          </Alert>
        ) : null}

        {data != null ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            <Field label="Papel" value={ROLE_LABELS[data.role]} />
            <Field label="Fuso horário" value={data.timeZone} />
            <Field label="Id da pessoa" value={data.personId} mono />
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs break-all' : 'text-sm'}>{value}</dd>
    </div>
  );
}

function IdentitySkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Skeleton className="h-9" />
      <Skeleton className="h-9" />
      <Skeleton className="h-9" />
    </div>
  );
}
