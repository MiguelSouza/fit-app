'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FieldError } from '@/components/auth/field-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PASSWORD_RESET_PATH } from '@/lib/routes';
import { supabaseBrowserAuth } from '@/lib/supabase/browser';

const signInSchema = z.object({
  email: z.email({ error: 'Informe um e-mail válido.' }),
  password: z.string().min(1, { error: 'Informe sua senha.' }),
});

type SignInValues = z.infer<typeof signInSchema>;

/**
 * Signing in with e-mail and password.
 *
 * Signing in is the one thing the panel asks Supabase directly (rule 6 of
 * `CLAUDE.md`). What comes back is a session in a cookie, which the server can
 * then read: hence the `router.refresh()` after signing in, so the layout of the
 * panel renders again with the session already in hand.
 */
export function SignInForm({
  destination,
  expiredLink,
}: {
  destination: string;
  expiredLink: boolean;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  async function signIn({ email, password }: SignInValues) {
    setFailed(false);

    const { error } = await supabaseBrowserAuth().signInWithPassword({ email, password });

    if (error) {
      // One message, for any reason, like the 401 of the API (ADR 0007):
      // saying "this e-mail does not exist" hands whoever is only guessing the
      // list of who has an account here. And nothing goes to the console: the
      // error object of Auth carries the e-mail of the attempt.
      setFailed(true);
      return;
    }

    router.replace(destination);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Use o e-mail e a senha da sua conta.</CardDescription>
      </CardHeader>

      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(signIn)} noValidate>
          {expiredLink ? (
            <Alert>O link do e-mail expirou ou já foi usado. Peça um novo abaixo.</Alert>
          ) : null}

          {failed ? <Alert variant="destructive">E-mail ou senha incorretos.</Alert> : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              aria-invalid={form.formState.errors.email != null}
              {...form.register('email')}
            />
            <FieldError message={form.formState.errors.email?.message} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={form.formState.errors.password != null}
              {...form.register('password')}
            />
            <FieldError message={form.formState.errors.password?.message} />
          </div>

          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Entrando…' : 'Entrar'}
          </Button>

          <Link
            href={PASSWORD_RESET_PATH}
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Esqueci minha senha
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
