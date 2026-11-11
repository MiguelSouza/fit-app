import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { concatMap, type Observable } from 'rxjs';
import { z } from 'zod';

import { authenticatedUserOf } from '../../../shared/auth/authenticated-user';
import { AccessLogService } from '../application/access-log.service';
import { LoadProfessionalCaller } from '../application/load-professional-caller';
import { type AccessLogAction, type AccessLogResource } from '../domain/access-log';

/**
 * Metadata key `@RecordsPatientAccess()` writes: what this route is an access
 * to. Namespaced, so nothing else can set it by accident.
 */
export const PATIENT_ACCESS_RECORD = 'fit-app:identity:patientAccessRecord';

/** What the decorator declared about a route. */
export interface PatientAccessRecord {
  readonly resource: AccessLogResource;
  readonly action: AccessLogAction;
  /** The route parameter holding the patient's profile id. */
  readonly parameter: string;
}

/** The id of the patient, as it comes off the path. A uuid, as the column is. */
const patientIdSchema = z.uuid();

/**
 * The interceptor behind `@RecordsPatientAccess()`: one record per visit
 * (card I-06).
 *
 * **Why an interceptor and not the guard.** The guard answers "pode?" and runs
 * on every request that touches a patient — a poll, a save, a list — and most
 * of those are not somebody opening a ficha. Recording there would fill the
 * patient's list with rows that mean nothing and would record accesses that
 * never happened, which is exactly what ADR 0017 refused to do. Here the route
 * says what it is, and only the route that *is* the opening of the chart says
 * it: **one visit, one record**, which is the card's first acceptance
 * criterion.
 *
 * **It records after the handler, not before.** The row goes in once the
 * handler has produced an answer, so a request that was refused or that broke
 * writes nothing: the log says what was really seen. And it is **awaited** —
 * if the record cannot be written, the request fails with it. That is
 * deliberate and it is the LGPD reading of the trade: an access nobody can
 * prove is worse than an access that did not happen.
 *
 * **It is not the authorization check.** A route that records an access should
 * also require one (`@RequiresPatientAccess()`), and the two are separate
 * decorators because they answer separate questions — and because a job or an
 * export that has no HTTP request at all calls `AccessLogService` directly.
 */
@Injectable()
export class PatientAccessLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly callers: LoadProfessionalCaller,
    private readonly accessLog: AccessLogService,
  ) {}

  /**
   * @throws Error on a route that is `@Public()`, or that has no such
   *   parameter, or whose parameter is not a patient id: all three are wiring
   *   mistakes, they come out as a 500, and the stack points here. A silent
   *   "no record" is the one failure this file must not have — it would be an
   *   access nobody is told about.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const record = this.reflector.getAllAndOverride<PatientAccessRecord | undefined>(
      PATIENT_ACCESS_RECORD,
      [context.getHandler(), context.getClass()],
    );

    if (record === undefined) {
      throw new Error('PatientAccessLogInterceptor used without @RecordsPatientAccess()');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = authenticatedUserOf(request);

    if (user === undefined) {
      throw new Error('@RecordsPatientAccess() used on a route that does not require a token');
    }

    const patientId = patientIdSchema.safeParse(request.params[record.parameter]);

    if (!patientId.success) {
      throw new Error(
        `@RecordsPatientAccess() expects a ':${record.parameter}' parameter holding a patient id`,
      );
    }

    return next.handle().pipe(
      concatMap(async (answer: unknown) => {
        // The profile id and not the practice, as in the guard: a clinic
        // member belongs to more than one, and who accessed is the person.
        const professionalId = await this.callers.professionalProfileId(user.id);

        await this.accessLog.logAccess(
          professionalId,
          patientId.data,
          record.resource,
          record.action,
        );

        return answer;
      }),
    );
  }
}
