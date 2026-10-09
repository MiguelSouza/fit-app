import { Module } from '@nestjs/common';

/**
 * `nutrition`: alimentos, planos, refeições, opções, cálculo de macros, adesão
 *
 * Owns the `nutrition` Postgres schema and reads nothing else (CLAUDE.md rule 2).
 *
 * Empty while the cards that fill it are open: the folders of the four layers
 * are already there, and `src/health-check` is the slice to copy the pattern
 * from. See `src/modules/README.md`.
 */
@Module({})
export class NutritionModule {}
