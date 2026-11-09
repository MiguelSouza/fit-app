/**
 * Public API of `identity`: the only file another module is allowed to import
 * (CLAUDE.md rule 1, enforced by `@fit-app/config/eslint/api`).
 *
 * What goes out from here is the Nest module and the access rule of the
 * platform — the service a use case injects and the decorator a controller
 * puts on a route with a patient in it. Nothing else: the ports, the
 * repositories, the domain and the controllers stay inside.
 *
 * A module that uses either of the two imports `IdentityModule` as well, which
 * is what makes them resolvable from its own context.
 */
export { IdentityModule } from './identity.module';

/**
 * The one answer to "pode este profissional ver este paciente?" — active care
 * link **and** `share_with_professional` in force (CLAUDE.md, "Saúde e LGPD").
 * Nobody reimplements it; every module calls this.
 */
export { PatientAccessService } from './application/patient-access.service';

/** The same rule in front of an HTTP route that carries the patient in the path. */
export { RequiresPatientAccess } from './presentation/requires-patient-access.decorator';
