import { addDays, isAfter } from 'date-fns';

import {
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationRevokedError,
} from './identity-errors';

/**
 * The invitation a professional sends a patient by link (card I-02).
 *
 * Pure: no NestJS, no Drizzle, no I/O (CLAUDE.md rule 4). What is decided here
 * is everything that is not storage — how long an invitation lives, what its
 * status is at a given instant, and whether it may be accepted — and the
 * repository writes what comes out.
 *
 * The token is **not** part of this file. What the database keeps is a hash of
 * it, produced behind the `InvitationTokenIssuer` port, because generating a
 * random secret and hashing it is platform work and the domain stays free of
 * it (CLAUDE.md rule 5). The domain only ever sees `tokenHash`.
 */

/**
 * How long a link is good for. Fourteen days, as the card asks: long enough
 * for a patient who saw the message on a Friday and got to it the week after,
 * short enough that a link forwarded to the wrong chat stops working.
 */
export const INVITATION_LIFETIME_IN_DAYS = 14;

/**
 * Where an invitation is in its life. Not a column: read off the dates, by
 * `invitationStatusOf`, so there is no job turning `pending` into `expired` at
 * midnight and no window in which the row disagrees with the clock.
 */
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

/** What the caller asked for. `null` means "not said", not "empty". */
export interface InvitationRequest {
  /** The organization the invitation belongs to, and never the caller's wish. */
  readonly organizationId: string;
  /** Which professional of that organization sent it. */
  readonly invitedByProfileId: string;
  readonly name: string | null;
  readonly contact: string | null;
  /** The hash of the token, from the issuer. The token itself never lands here. */
  readonly tokenHash: string;
  /** The instant the invitation is being created, which the expiry hangs off. */
  readonly now: Date;
}

/** The row the repository writes, decided. It invents nothing of its own. */
export interface InvitationToCreate {
  readonly organizationId: string;
  readonly invitedByProfileId: string;
  readonly name: string | null;
  readonly contact: string | null;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

/**
 * An invitation as it stands, read back from the repository.
 *
 * Every instant is UTC, as everything else in this platform (CLAUDE.md, "Dados
 * de saúde"). There is no `status` field: it is a function of these dates and
 * of the instant you ask, which is why the three timestamps travel and the
 * conclusion does not.
 */
export interface Invitation {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string | null;
  readonly contact: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

/**
 * Collapses the whitespace of something a person typed, as
 * `professional-registration.ts` does for the name of a professional: the ends
 * trimmed and every run of spaces inside reduced to one.
 */
function squeeze(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

/** A field nobody filled in and one filled with spaces are the same absence. */
function optionalText(value: string | null): string | null {
  if (value === null) return null;

  const squeezed = squeeze(value);

  return squeezed === '' ? null : squeezed;
}

/**
 * Turns what the professional asked for into the row that gets written.
 *
 * The expiry is decided here and not in the column's default: it is a product
 * rule ("expira em 14 dias"), it has to be the same for a row written by a
 * seed, and a test has to be able to ask for an invitation that expired
 * yesterday without waiting two weeks.
 */
export function invitationToCreate(request: InvitationRequest): InvitationToCreate {
  return {
    organizationId: request.organizationId,
    invitedByProfileId: request.invitedByProfileId,
    name: optionalText(request.name),
    contact: optionalText(request.contact),
    tokenHash: request.tokenHash,
    expiresAt: addDays(request.now, INVITATION_LIFETIME_IN_DAYS),
  };
}

/**
 * What the invitation is at `now`.
 *
 * The order is the point. `accepted` wins over `expired`, because an
 * invitation that was used is spent and saying it expired afterwards would be
 * a lie about what happened; `revoked` wins over `expired` for the same
 * reason. An accepted invitation that is then revoked cannot happen — revoking
 * only works on a pending one — and if it ever did, `accepted` is the truth
 * that matters: the patient is already in.
 */
export function invitationStatusOf(invitation: Invitation, now: Date): InvitationStatus {
  if (invitation.acceptedAt !== null) return 'accepted';
  if (invitation.revokedAt !== null) return 'revoked';

  // Strictly after, so an invitation is still good on the very instant it
  // expires. The boundary has to fall somewhere and this is the kinder side.
  return isAfter(now, invitation.expiresAt) ? 'expired' : 'pending';
}

/** Whether a professional may still revoke it: there is nothing else to undo. */
export function isPending(invitation: Invitation, now: Date): boolean {
  return invitationStatusOf(invitation, now) === 'pending';
}

/**
 * The rule the card asks for: an invitation that expired, was revoked or was
 * already used **cannot be accepted**.
 *
 * It lives here, in the domain, and not inside the use case that will accept
 * one: the patient's side of the invitation is another card (the
 * professional–patient link and the consent that comes with it), and the rule
 * it has to obey is written and tested before the flow that reads it exists.
 * Whoever writes that use case calls this and gets the refusal for free.
 *
 * @throws InvitationAlreadyAcceptedError when somebody already used the link
 * @throws InvitationRevokedError when the professional took it back
 * @throws InvitationExpiredError when the fourteen days are gone
 */
export function invitationReadyToAccept(invitation: Invitation, now: Date): Invitation {
  const status = invitationStatusOf(invitation, now);

  if (status === 'accepted') throw new InvitationAlreadyAcceptedError();
  if (status === 'revoked') throw new InvitationRevokedError();
  if (status === 'expired') throw new InvitationExpiredError();

  return invitation;
}
