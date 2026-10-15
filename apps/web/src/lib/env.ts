import { z } from 'zod';

/**
 * The three variables the panel needs, validated before anybody uses them.
 *
 * All of them are `NEXT_PUBLIC_*`, which is to say they go to the browser: the
 * address of the API, the address of Supabase and the **anon** key, which is
 * public by definition. The service role key does not appear here or anywhere
 * else in the panel — it ignores RLS and only the API uses it
 * (`.env.example`).
 *
 * `next build` writes the value of each one into the bundle, so what counts is
 * the environment of the build, not the one of the server that runs afterwards.
 */
const publicEnvSchema = z.object({
  apiUrl: z.url({ error: 'NEXT_PUBLIC_API_URL precisa ser uma URL.' }),
  supabaseUrl: z.url({ error: 'NEXT_PUBLIC_SUPABASE_URL precisa ser uma URL.' }),
  supabaseAnonKey: z.string().min(1, { error: 'NEXT_PUBLIC_SUPABASE_ANON_KEY é obrigatória.' }),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let parsed: PublicEnv | undefined;

/**
 * Reads and validates the environment, once per process (or per tab, in the
 * browser).
 *
 * It is a function, and not an exported constant, because of the build: a
 * module that validates while being imported would break `next build`, which
 * renders the pages with none of these variables set. Called from whoever opens
 * the Supabase or the API client, the validation happens when there is a real
 * request to serve.
 *
 * @throws when a variable is missing or its value is no good, naming each one —
 * never printing a value.
 */
export function publicEnv(): PublicEnv {
  parsed ??= parsePublicEnv();

  return parsed;
}

function parsePublicEnv(): PublicEnv {
  // Each reference is spelled out because that is how Next.js recognises and
  // replaces it: `process.env[name]` is swapped for no value at all and would
  // reach the browser as `undefined`.
  const result = publicEnvSchema.safeParse({
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!result.success) {
    const reasons = result.error.issues.map((issue) => issue.message).join(' ');

    throw new Error(
      `Ambiente do painel incompleto: ${reasons} Copie .env.example para .env na raiz do repositório e preencha o bloco de apps/web.`,
    );
  }

  return result.data;
}
