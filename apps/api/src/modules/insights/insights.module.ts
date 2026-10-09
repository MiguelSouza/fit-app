import { Module } from '@nestjs/common';

/**
 * `insights`: regras de alerta, alertas, resumos por IA, intervenções, linha do tempo
 *
 * Owns the `insights` Postgres schema and reads nothing else (CLAUDE.md rule 2).
 *
 * Empty while the cards that fill it are open: the folders of the four layers
 * are already there, and `src/health-check` is the slice to copy the pattern
 * from. See `src/modules/README.md`.
 */
@Module({})
export class InsightsModule {}
