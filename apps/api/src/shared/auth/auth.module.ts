import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { EnvModule } from '../config/env.module';
import { SupabaseJwtGuard } from './supabase-jwt.guard';
import { SupabaseTokenVerifier } from './supabase-token-verifier';

/**
 * Authentication for the whole API: the token verifier and the guard that
 * runs in front of every route.
 *
 * `APP_GUARD` and not `app.useGlobalGuards`, for the same reason the error
 * filter is a provider: the guard gets its dependencies injected, and a test
 * that boots `AppModule` is protected exactly like the API is — a test that
 * passed because the guard was only wired in `main.ts` would prove nothing.
 */
@Module({
  imports: [EnvModule],
  providers: [SupabaseTokenVerifier, { provide: APP_GUARD, useClass: SupabaseJwtGuard }],
})
export class AuthModule {}
