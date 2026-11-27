/**
 * Public API of `identity`: the only file another module is allowed to import
 * (CLAUDE.md rule 1, enforced by `@fit-app/config/eslint/api`).
 *
 * What goes out from here is the Nest module, the access rule of the platform
 * — the service a use case injects and the decorator a controller puts on a
 * route with a patient in it —, the access log, which is the other obligation
 * every module shares (CLAUDE.md, "Saúde e LGPD": checar o acesso **e**
 * registrá-lo), and the two ways of resolving **who is calling**, which is the
 * line every use case of every module writes first. Nothing else: the ports,
 * the repositories, the domain and the controllers stay inside.
 *
 * A module that uses any of these imports `IdentityModule` as well, which is
 * what makes them resolvable from its own context.
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

/**
 * `identity.logAccess`: the one way to record that somebody opened or
 * exported a patient's data (card I-06, CLAUDE.md "Saúde e LGPD"). A use
 * case, a job or an export calls this; nobody writes their own table.
 */
export { AccessLogService } from './application/access-log.service';

/**
 * The same record behind an HTTP route that *is* the visit — one row per
 * request served, and only on the route that opens the ficha.
 */
export { RecordsPatientAccess } from './presentation/records-patient-access.decorator';

/** The vocabulary of the log, for whoever calls either of the two above. */
export { type AccessLogAction, type AccessLogResource } from './domain/access-log';

/**
 * Who is calling, as a patient about themselves: the profile id and the time
 * zone their days are counted in (card P-02).
 *
 * Every module has routes a patient points at their own data — the check-ins
 * of `health`, the diary of `nutrition` — and the first line of each of those
 * use cases is this one. It lives here for the same reason the access rule
 * does: resolving the caller is authorization, and the copy somebody writes by
 * hand is the one that forgets to refuse a professional.
 *
 * The zone travels with the id because it has to: which Tuesday a check-in is
 * about is read where the patient is (CLAUDE.md, "Dados de saúde"), and the
 * column it comes from belongs to this module (rule 2).
 */
export { LoadPatientCaller } from './application/load-patient-caller';
export { type PatientCaller } from './domain/patient-caller';

/**
 * The mirror of it: who is calling, as a professional.
 *
 * It answers the profile id the access rule asks for, which is what a use case
 * behind `@RequiresPatientAccess()` needs to make the same check itself — a
 * guard answers for an HTTP route, and the rule inside the use case is not
 * optional (ADR 0017).
 */
export { LoadProfessionalCaller } from './application/load-professional-caller';
