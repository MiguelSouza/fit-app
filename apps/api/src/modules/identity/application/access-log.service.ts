import { Inject, Injectable } from '@nestjs/common';

import { accessToLog, type AccessLogAction, type AccessLogResource } from '../domain/access-log';
import { ACCESS_LOG_REPOSITORY, type AccessLogRepository } from './ports/access-log.port';

/**
 * `identity.logAccess`: the one place the platform records that somebody
 * opened or exported a patient's data (card I-06, CLAUDE.md "Saúde e LGPD" —
 * "registrar acesso ao abrir a ficha de um paciente ou exportar dados").
 *
 * It leaves the module through `index.ts`, next to `PatientAccessService`, and
 * for the same reason: every module calls this one and **nobody writes their
 * own**. A second way of recording an access is a second vocabulary, a second
 * set of columns and, a year later, a patient's "quem viu meus dados" that is
 * missing half of what happened.
 *
 * **It is not the authorization check.** `PatientAccessService` answers
 * whether the professional may see the patient, before anything is read (ADR
 * 0017); this one is called *because* something was read. Conflating the two
 * would log every request that merely checked a permission, and the card asks
 * for exactly one record per visit — so a refused access writes nothing here,
 * and an access that happened always does.
 *
 * **Nothing is logged to the logger.** Which patient a professional opened is
 * personal data about somebody's health (CLAUDE.md, "Saúde e LGPD"), and the
 * record itself is where it belongs: a row the patient can read, not a line in
 * CloudWatch.
 */
@Injectable()
export class AccessLogService {
  constructor(@Inject(ACCESS_LOG_REPOSITORY) private readonly records: AccessLogRepository) {}

  /**
   * Records one access. It is awaited, and a failure is **not** swallowed: the
   * caller that cannot write the record must fail with it, because an access
   * nobody can prove happened is the one thing this table exists to prevent.
   *
   * @param actorProfileId `identity.profile.id` of whoever accessed — ours,
   *   never the Supabase user id
   * @param patientProfileId `identity.profile.id` of the patient whose data
   *   was accessed
   * @param resource what was accessed (today, the chart)
   * @param action whether it was read on the screen or exported
   * @throws Error when the two ids are the same person, or either is blank:
   *   a bug in the caller, never a refusal (`accessToLog`)
   */
  async logAccess(
    actorProfileId: string,
    patientProfileId: string,
    resource: AccessLogResource,
    action: AccessLogAction,
  ): Promise<void> {
    await this.records.append(
      accessToLog(actorProfileId, patientProfileId, resource, action, new Date()),
    );
  }
}
