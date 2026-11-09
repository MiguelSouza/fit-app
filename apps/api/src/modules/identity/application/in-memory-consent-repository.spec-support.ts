import {
  CURRENT_TERMS_VERSION,
  type ConsentInForce,
  type ConsentToGrant,
  type ConsentType,
  type RevokedConsent,
} from '../domain/consent';
import { type ConsentRepository } from './ports/consent-repository.port';

/** A row of `identity.consent`, as this double keeps it: never deleted. */
interface ConsentRow {
  readonly type: ConsentType;
  readonly termsVersion: string;
  readonly grantedAt: Date;
  revokedAt: Date | null;
}

/**
 * The consents without a database, for the tests that are about the use cases
 * and not about the SQL (card I-05).
 *
 * What it reproduces faithfully is the one thing the use cases lean on: **a
 * revocation dates the row and never removes it**, so a second grant of the
 * same purpose is a new row beside the old one and `rows` keeps the whole
 * history — which is what lets a unit test assert the card's first acceptance
 * criterion without Postgres.
 *
 * What only the real one can prove is that the partial unique index refuses a
 * second consent in force, that the cascade of `health_data` is one
 * transaction, and that the professional's access is gone on the next request;
 * that is `consents.use-case.integration-spec.ts` (CLAUDE.md, "Testes"). No
 * data of a real person goes in here: a purpose is a code and a profile is an
 * id.
 */
export class InMemoryConsentRepository implements ConsentRepository {
  /** Every row ever written, for the profile this double was built for. */
  readonly rows: ConsentRow[] = [];

  /**
   * @param profileId the only profile this double answers for, which is all a
   *   use-case test needs: every request resolves the caller to one profile
   * @param inForce the purposes already granted, against the current terms
   */
  constructor(
    private readonly profileId: string,
    inForce: readonly ConsentType[] = [],
  ) {
    for (const type of inForce) {
      this.rows.push({
        type,
        termsVersion: CURRENT_TERMS_VERSION,
        grantedAt: new Date('2026-11-01T12:00:00.000Z'),
        revokedAt: null,
      });
    }
  }

  findInForce(profileId: string): Promise<readonly ConsentInForce[]> {
    this.assertKnown(profileId);

    return Promise.resolve(this.rows.filter((row) => row.revokedAt === null).map(toConsentInForce));
  }

  grant(profileId: string, toGrant: ConsentToGrant): Promise<ConsentInForce> {
    this.assertKnown(profileId);

    const inForce = this.rows.find((row) => row.type === toGrant.type && row.revokedAt === null);

    // What the partial unique index does: one consent in force per purpose.
    if (inForce !== undefined) return Promise.resolve(toConsentInForce(inForce));

    const row: ConsentRow = { ...toGrant, revokedAt: null };
    this.rows.push(row);

    return Promise.resolve(toConsentInForce(row));
  }

  revoke(
    profileId: string,
    types: readonly ConsentType[],
    revokedAt: Date,
  ): Promise<readonly RevokedConsent[]> {
    this.assertKnown(profileId);

    const dated = this.rows.filter((row) => types.includes(row.type) && row.revokedAt === null);

    // The row stays and is dated. Nothing here removes anything, ever.
    for (const row of dated) row.revokedAt = revokedAt;

    return Promise.resolve(dated.map((row) => ({ ...toConsentInForce(row), revokedAt })));
  }

  /** A profile this double was not built for is a bug in the test, not a miss. */
  private assertKnown(profileId: string): void {
    if (profileId !== this.profileId) {
      throw new Error(`this double only answers for ${this.profileId}`);
    }
  }
}

function toConsentInForce(row: ConsentRow): ConsentInForce {
  return { type: row.type, termsVersion: row.termsVersion, grantedAt: row.grantedAt };
}
