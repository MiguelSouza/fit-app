'use client';

import { type Invitation, type InvitationStatus } from '@fit-app/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import { invitationsQuery, revokeInvitation } from '@/lib/api/invitations';
import { cn } from '@/lib/utils';

/** pt-BR for each `InvitationStatus` of the contract. */
const STATUS_LABELS: Record<InvitationStatus, string> = {
  pending: 'Pendente',
  accepted: 'Aceito',
  expired: 'Expirado',
  revoked: 'Revogado',
};

/**
 * How each status looks. Only `pending` is highlighted: it is the one that
 * still needs something from the professional.
 */
const STATUS_STYLES: Record<InvitationStatus, string> = {
  pending: 'border-primary/40 bg-primary/10 text-foreground',
  accepted: 'border-input bg-muted text-muted-foreground',
  expired: 'border-input bg-muted text-muted-foreground',
  revoked: 'border-input bg-muted text-muted-foreground',
};

/**
 * The invitations of the practice, with the status of each (card I-02).
 *
 * The status comes from the API and is not computed here: `expired` depends on
 * the instant the question is asked, and a browser clock that is an hour off
 * would otherwise show a link as dead while it still works
 * (`packages/contracts/src/identity/invitation.ts`).
 *
 * The token is not in this list and cannot be: the API answers it once, on the
 * creation. So there is no "copy link" here — only "revogar", which kills the
 * link on the spot, and creating a new invitation next door.
 */
export function InvitationList() {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery(invitationsQuery);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const revoke = useMutation({
    mutationFn: revokeInvitation,

    onMutate: () => {
      setFailure(undefined);
    },

    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invitationsQuery.queryKey });
    },

    onError: (reason: unknown) => {
      // The message of the API is already pt-BR and carries no personal data,
      // so it goes on the screen as it is — it is also what says "esse convite
      // já não está pendente", which happens when the patient accepted while
      // the screen was open.
      setFailure(
        reason instanceof ApiError
          ? reason.message
          : 'Não foi possível revogar o convite agora. Tente novamente.',
      );
    },
  });

  return (
    <Card aria-busy={isPending}>
      <CardHeader>
        <CardTitle>Convites enviados</CardTitle>
        <CardDescription>
          Do mais recente para o mais antigo. Um convite revogado para de funcionar na hora.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {isPending ? <ListSkeleton /> : null}

        {error != null ? (
          <Alert variant="destructive">
            Não foi possível carregar seus convites agora. Recarregue a página em instantes.
          </Alert>
        ) : null}

        {failure != null ? <Alert variant="destructive">{failure}</Alert> : null}

        {data != null && data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Você ainda não convidou ninguém. Gere um link acima.
          </p>
        ) : null}

        {data != null && data.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {data.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                revoking={revoke.isPending && revoke.variables === invitation.id}
                onRevoke={() => {
                  revoke.mutate(invitation.id);
                }}
              />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InvitationRow({
  invitation,
  revoking,
  onRevoke,
}: {
  invitation: Invitation;
  revoking: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium">{invitation.name ?? 'Sem nome'}</span>

        <span className="truncate text-xs text-muted-foreground">
          {invitation.contact ?? 'Sem contato'} · {whenItSays(invitation)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs',
            STATUS_STYLES[invitation.status],
          )}
        >
          {STATUS_LABELS[invitation.status]}
        </span>

        {invitation.status === 'pending' ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRevoke} disabled={revoking}>
            {revoking ? 'Revogando…' : 'Revogar'}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The one date that matters for each status, in the professional's own time
 * zone: when the link dies, when it was used, when it was taken back.
 */
function whenItSays(invitation: Invitation): string {
  if (invitation.status === 'accepted' && invitation.acceptedAt != null) {
    return `aceito em ${day(invitation.acceptedAt)}`;
  }

  if (invitation.status === 'revoked' && invitation.revokedAt != null) {
    return `revogado em ${day(invitation.revokedAt)}`;
  }

  return invitation.status === 'expired'
    ? `expirou em ${day(invitation.expiresAt)}`
    : `expira em ${day(invitation.expiresAt)}`;
}

function day(isoDate: string): string {
  return format(new Date(isoDate), 'dd/MM/yyyy');
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  );
}
