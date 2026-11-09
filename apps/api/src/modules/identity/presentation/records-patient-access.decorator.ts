import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';

import { type AccessLogAction, type AccessLogResource } from '../domain/access-log';
import { DEFAULT_PATIENT_ID_PARAM } from './patient-access.guard';
import {
  PatientAccessLogInterceptor,
  PATIENT_ACCESS_RECORD,
} from './patient-access-log.interceptor';

/**
 * Records in the access log that this route was served: one row per request
 * that succeeded (card I-06, CLAUDE.md "Saúde e LGPD" — "registrar acesso ao
 * abrir a ficha de um paciente ou exportar dados").
 *
 * ```ts
 * @Get(':patientId/chart')
 * @RequiresPatientAccess()
 * @RecordsPatientAccess('patient_chart', 'view')
 * chart(@Param('patientId') patientId: string) { ... }
 * ```
 *
 * **It goes on the route that is the visit, and on no other.** A chart screen
 * makes several requests, and the patient's list must say "a nutricionista
 * abriu a sua ficha" once — not five times, one per widget that loaded. The
 * route that opens the ficha carries this; the ones that fill it in do not.
 * That is the card's criterion "exatamente um registro por visita", and no
 * deduplication window is doing the work: two visits are two records, however
 * close together, because they are two facts.
 *
 * **Put `@RequiresPatientAccess()` on it too.** This one records; it does not
 * authorize (ADR 0017). The route that records without requiring is a route
 * that writes down an access it never checked.
 *
 * The record is written **after** the handler answers, and the request fails
 * if it cannot be written — an access nobody can prove is the thing this table
 * exists to prevent.
 *
 * A module that uses it imports `IdentityModule`, which is what makes the
 * interceptor — and the log service behind it — resolvable from that module's
 * context. For a job, a worker or an export with no HTTP request, the service
 * is the way in: `AccessLogService.logAccess(...)`.
 *
 * @param resource what the route gives access to
 * @param action whether it is read on the screen or exported
 * @param parameter the route parameter holding the patient's profile id, when
 *   it is not `patientId`. A route that renames it tells both decorators.
 */
export function RecordsPatientAccess(
  resource: AccessLogResource,
  action: AccessLogAction,
  parameter: string = DEFAULT_PATIENT_ID_PARAM,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(PATIENT_ACCESS_RECORD, { resource, action, parameter }),
    UseInterceptors(PatientAccessLogInterceptor),
  );
}
