import { Module } from '@nestjs/common';

import { MeController } from './presentation/me.controller';

/**
 * `identity`: pessoas, organizações, vínculos, convites, consentimentos, registro de acessos
 *
 * Owns the `identity` Postgres schema and reads nothing else (CLAUDE.md rule 2).
 *
 * Almost empty while the cards that fill it are open: all it answers today is
 * the provisional `GET /v1/me` of card F-09. `src/health-check` is the slice to
 * copy the pattern from — see `src/modules/README.md`.
 */
@Module({ controllers: [MeController] })
export class IdentityModule {}
