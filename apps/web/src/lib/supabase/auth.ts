import { type SupabaseClient } from '@supabase/supabase-js';

/**
 * What the panel gets from Supabase: the auth client, and nothing else.
 *
 * Both constructors — `browser.ts` and `server.ts` — return `client.auth`
 * instead of the whole client, and that narrowing is rule 6 of `CLAUDE.md`
 * turned into a type: without the full client there is no `.from()`, no
 * `.rpc()` and no `.storage` for anyone to reach for by accident. Signing in is
 * the one thing the panel asks Supabase directly; patient data comes from the
 * API, which is what checks the link and the consent.
 *
 * A pull request does not have to go looking for direct database access here:
 * it does not compile.
 */
export type SupabaseAuth = SupabaseClient['auth'];
