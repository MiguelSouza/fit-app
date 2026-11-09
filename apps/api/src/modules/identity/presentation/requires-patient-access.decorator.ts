import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import {
  DEFAULT_PATIENT_ID_PARAM,
  PATIENT_ACCESS_PARAM,
  PatientAccessGuard,
} from './patient-access.guard';

/**
 * Closes a route behind the access rule of `identity`: the caller is a
 * professional with an **active link** to the patient in the path and the
 * patient's `share_with_professional` consent is **in force**, or the route
 * answers 404 (card I-04, CLAUDE.md "Saúde e LGPD").
 *
 * ```ts
 * @Get(':patientId/chart')
 * @RequiresPatientAccess()
 * chart(@Param('patientId', { schema: patientIdSchema }) patientId: string) { ... }
 * ```
 *
 * It is one decorator and not two because the two halves are useless apart:
 * the metadata names the parameter, the guard reads it, and a route that
 * declared one without the other would be a route that looks protected and is
 * not. `applyDecorators` is what puts them on together.
 *
 * A module that uses it imports `IdentityModule`, which is what makes the
 * guard — and the access service behind it — resolvable from that module's
 * context. The import is of the module's `index.ts` and of nothing inside it
 * (CLAUDE.md rule 1).
 *
 * @param parameter the route parameter holding the patient's profile id, when
 *   it is not `patientId`. On a controller it answers for every route under
 *   it, and a single route may still override it.
 */
export function RequiresPatientAccess(
  parameter: string = DEFAULT_PATIENT_ID_PARAM,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(PATIENT_ACCESS_PARAM, parameter),
    UseGuards(PatientAccessGuard),
  );
}
