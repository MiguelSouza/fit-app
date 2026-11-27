/**
 * Public API of `health`: the only file another module is allowed to import
 * (CLAUDE.md rule 1, enforced by `@fit-app/config/eslint/api`).
 *
 * What goes out from here is the Nest module and, later, the services and
 * types other modules call. Nothing from `domain/`, `infrastructure/` or
 * `presentation/` is exported by accident.
 *
 * The check-ins of card P-02 are **not** here, deliberately, and the absence
 * is the design: `insights` is the module that will read them, and what it
 * reacts to is `health.checkin.recorded` on the bus (CLAUDE.md rule 3). The
 * day something has to ask this module for a check-in rather than react to
 * one, a service shows up here with the consent check inside it — never a
 * repository, and never a type that lets another module write one.
 */
export { HealthModule } from './health.module';
