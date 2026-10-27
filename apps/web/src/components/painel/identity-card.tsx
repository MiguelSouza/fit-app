'use client';

import { type PersonRole, type ProfessionalType } from '@fit-app/api-client';
import { useQuery } from '@tanstack/react-query';

import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { meQuery } from '@/lib/api/me';

const ROLE_LABELS: Record<PersonRole, string> = {
  professional: 'Profissional',
  patient: 'Paciente',
};

/** pt-BR for each `professional_type` of the contract. */
const PROFESSIONAL_TYPE_LABELS: Record<ProfessionalType, string> = {
  nutritionist: 'Nutricionista',
  trainer: 'Treinador',
};

/**
 * Who is using the panel, according to the API.
 *
 * It is `GET /v1/me` end to end, which is what card F-13 asks to prove: the
 * Supabase session becomes an `Authorization: Bearer` in the generated client,
 * the API validates the token and answers the contract, and what it answered
 * shows up here. Since card I-01 that answer comes from the `identity` tables,
 * and it carries what the first access registered: the professional type, the
 * council number and the practice.
 *
 * The **name** is not among these fields, and that is not an oversight:
 * `MeResponse` carries ids and codes, and the only free text in it is the name
 * of the caller's own practice (`packages/contracts/src/identity/me.ts`).
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

            {data.professional != null ? (
              <>
                <Field label="Tipo" value={PROFESSIONAL_TYPE_LABELS[data.professional.type]} />
                <Field label="Conselho" value={data.professional.councilNumber} />
                <Field label="Especialidade" value={data.professional.specialty ?? '—'} />

                {data.professional.organizations.map((organization) => (
                  <Field
                    key={organization.organizationId}
                    label={organization.kind === 'solo' ? 'Consultório' : 'Clínica'}
                    value={organization.name}
                  />
                ))}
              </>
            ) : null}
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
