/**
 * The practice a professional works in. Pure: no NestJS, no driver, no I/O
 * (CLAUDE.md rule 4).
 */

/**
 * `solo` is the practice of a single professional, who owns it — the only kind
 * the MVP creates (card I-01). `clinic` is why the distinction exists at all:
 * a practice with more than one person in it is the same model with more
 * members.
 */
export type OrganizationKind = 'solo' | 'clinic';

/**
 * What a person may do inside the practice. It is **not** permission to read a
 * patient: that needs an active link and a `share_with_professional` consent
 * in force, checked in the use case that opens the chart (CLAUDE.md, "Saúde e
 * LGPD").
 */
export type OrganizationRole = 'owner' | 'member';

/** The practice created with a professional's registration, and their role in it. */
export const SOLO: OrganizationKind = 'solo';
export const OWNER: OrganizationRole = 'owner';
