/**
 * Public API of `insights`: the only file another module is allowed to import
 * (CLAUDE.md rule 1, enforced by `@fit-app/config/eslint/api`).
 *
 * What goes out from here is the Nest module and, later, the services and
 * types other modules call. Nothing from `domain/`, `infrastructure/` or
 * `presentation/` is exported by accident.
 */
export { InsightsModule } from './insights.module';
