import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { z } from 'zod';

import { authenticatedUserOf } from '../../../shared/auth/authenticated-user';
import { LoadProfessionalCaller } from '../application/load-professional-caller';
import { PatientAccessService } from '../application/patient-access.service';
import { PatientNotFoundError } from '../domain/identity-errors';

/**
 * Metadata key `@RequiresPatientAccess()` writes: which route parameter holds
 * the patient. Namespaced, so nothing else can set it by accident.
 */
export const PATIENT_ACCESS_PARAM = 'fit-app:identity:patientAccessParam';

/** The name a route uses unless it says otherwise: `/:patientId`. */
export const DEFAULT_PATIENT_ID_PARAM = 'patientId';

/**
 * The id of the patient, as it comes off the path. A uuid, because
 * `identity.profile.id` is one.
 *
 * The guard runs before the validation pipe, so this is the only thing between
 * a path segment and the query that would take it. An id that cannot name a
 * patient gets the same 404 as a patient that is not there — not a 400, which
 * would be one more way of telling a caller which ids are real.
 */
const patientIdSchema = z.uuid();

/**
 * The guard behind `@RequiresPatientAccess()`: no active link and no
 * `share_with_professional` consent in force, no handler (card I-04).
 *
 * It is wired by the decorator and not registered globally, which is a
 * deliberate difference from `SupabaseJwtGuard`. Authentication is the right
 * default for every route of this API; patient access is not, because most
 * routes have no patient in them — and a global guard that does nothing unless
 * it finds metadata would run before the token is verified, since global
 * guards go first. This one runs **after** it, so the caller is already known.
 *
 * What it does is the three lines every chart endpoint would otherwise repeat:
 * resolve the caller as a professional of a practice, read the patient off the
 * path, and ask the access service. The rule itself is not here — it is
 * `PatientAccessService`, which is the only place it lives (CLAUDE.md, "Saúde
 * e LGPD": use the module's access service, never reimplement it).
 *
 * **It is not a substitute for the check inside the use case.** A guard
 * answers for an HTTP route; a job, an event handler or a use case called from
 * another use case has no `ExecutionContext`, and those call
 * `assertCanAccessPatient` themselves.
 *
 * Opening a chart also has to be recorded (`identity.logAccess`, CLAUDE.md),
 * and that is the access log — another table, another card. When it lands, a
 * guard that already knows the professional, the patient and the route is
 * where it goes.
 */
@Injectable()
export class PatientAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly callers: LoadProfessionalCaller,
    private readonly access: PatientAccessService,
  ) {}

  /**
   * @throws PatientNotFoundError on any refusal — 404, so that a professional
   *   cannot tell a patient they may not see from one that does not exist
   * @throws ProfileNotFoundError when the caller never finished the first
   *   access (404), CallerIsNotProfessionalError when the account is a
   *   patient's (403). Neither says anything about the patient in the path.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const parameter = this.parameterOf(context);
    const request = context.switchToHttp().getRequest<Request>();
    const user = authenticatedUserOf(request);

    if (user === undefined) {
      // Only reachable on a route that is `@Public()`: the global guard let it
      // through without a caller. A wiring mistake, not a rejected request —
      // it comes out as a 500 and the stack points here.
      throw new Error('@RequiresPatientAccess() used on a route that does not require a token');
    }

    const raw = request.params[parameter];

    if (raw === undefined) {
      // The decorator is on a route that has no such parameter. Also a wiring
      // mistake, and one that would otherwise look like a patient nobody can
      // see — which is the kind of silence this platform must not have.
      throw new Error(
        `@RequiresPatientAccess() expects a ':${parameter}' parameter, and the route has none`,
      );
    }

    const patientId = patientIdSchema.safeParse(raw);

    if (!patientId.success) throw new PatientNotFoundError();

    const caller = await this.callers.execute(user.id);

    await this.access.assertCanAccessPatient(caller.profileId, patientId.data);

    return true;
  }

  /**
   * `getAllAndOverride`: the handler is asked first and the controller next, so
   * a controller can name the parameter once for every route under it and a
   * single route can still say something else.
   */
  private parameterOf(context: ExecutionContext): string {
    return (
      this.reflector.getAllAndOverride<string>(PATIENT_ACCESS_PARAM, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_PATIENT_ID_PARAM
    );
  }
}
