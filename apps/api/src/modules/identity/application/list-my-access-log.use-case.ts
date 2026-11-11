import { Inject, Injectable } from '@nestjs/common';

import {
  accessLogPage,
  accessLogPageSize,
  decodeAccessLogCursor,
  type AccessLogPage,
} from '../domain/access-log';
import { LoadPatientCaller } from './load-patient-caller';
import { ACCESS_LOG_REPOSITORY, type AccessLogRepository } from './ports/access-log.port';

/**
 * What the request asked for: a page size and where to continue from.
 *
 * Both are `| undefined` and not merely optional, because the API compiles
 * with `exactOptionalPropertyTypes`: what the controller hands over is the
 * parsed query, where an absent `cursor` really is the key with `undefined` in
 * it.
 */
export interface AccessLogQuery {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

/**
 * `GET /v1/me/access-log`: quem viu os meus dados, quando e o quê (card I-06).
 *
 * **Authorization, and the card's second acceptance criterion.** The subject
 * is the caller themselves, resolved from the `sub` of the verified token (ADR
 * 0007) and never from a field of the request — there is no patient id to
 * send, so there is nothing to try, and the query filters by that one profile.
 * A professional calling it gets 403: what a professional may see about a
 * patient is the chart, and opening it writes a row in this very table.
 *
 * **It needs no consent and no care link.** Reading who touched your data is
 * not a purpose the patient consents to, it is the right that makes the
 * consents meaningful — and a patient who has just revoked everything is
 * precisely the person most likely to come and look.
 *
 * **Nothing is cached and nothing is cut off at a date.** The answer is what
 * the rows say at this instant, from the newest down, and the page continues
 * by cursor so that an access recorded while the patient is reading cannot
 * push a row past them unseen.
 *
 * **Nothing is logged.** Who opened whose chart is personal data on both
 * sides (CLAUDE.md, "Saúde e LGPD"), so there is no log line in this file at
 * all.
 */
@Injectable()
export class ListMyAccessLogUseCase {
  constructor(
    private readonly caller: LoadPatientCaller,
    @Inject(ACCESS_LOG_REPOSITORY) private readonly records: AccessLogRepository,
  ) {}

  /**
   * @param authUserId the `sub` of the verified access token
   * @param query the page size and the cursor of the previous page, both
   *   optional
   * @throws ProfileNotFoundError when the caller has no profile (404),
   *   CallerIsNotPatientError when the account is a professional's (403)
   * @throws InvalidAccessLogCursorError when the cursor is not one this API
   *   minted (400)
   */
  async execute(authUserId: string, query: AccessLogQuery = {}): Promise<AccessLogPage> {
    const profileId = await this.caller.patientProfileId(authUserId);

    const pageSize = accessLogPageSize(query.limit);
    const before = query.cursor === undefined ? undefined : decodeAccessLogCursor(query.cursor);

    // One row more than the page: the extra one is never answered, it is what
    // says there is a next page — cheaper and more honest than a `count(*)`
    // over a table that only grows.
    const rows = await this.records.findPage(profileId, pageSize + 1, before);

    return accessLogPage(rows, pageSize);
  }
}
