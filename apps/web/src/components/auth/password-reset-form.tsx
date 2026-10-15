'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FieldError } from '@/components/auth/field-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AUTH_CALLBACK_PATH,
  DESTINATION_PARAM,
  NEW_PASSWORD_PATH,
  SIGN_IN_PATH,
} from '@/lib/routes';
import { supabaseBrowserAuth } from '@/lib/supabase/browser';

const passwordResetSchema = z.object({
  email: z.email({ error: 'Informe um e-mail válido.' }),
});

type PasswordResetValues = z.infer<typeof passwordResetSchema>;

/**
 * Asking for the recovery e-mail.
 *
 * The link in the e-mail comes back to `auth/callback`, which trades the code for
 * a session and sends the person to `/nova-senha`. In development the e-mail does
 * not leave the machine: it lands in Mailpit, at http://127.0.0.1:54324.
 */
export function PasswordResetForm() {
  const [sent, setSent] = useState(false);

  const form = useForm<PasswordResetValues>({
    resolver: zodResolver(passwordResetSchema),
    defaultValues: { email: '' },
  });

  async function requestReset({ email }: PasswordResetValues) {
    // `window.location.origin` and not an environment variable: Auth requires
    // the address to be in `additional_redirect_urls` (`supabase/config.toml`),
    // and `localhost` and `127.0.0.1` are different origins to a browser. Using
    // the origin of whoever is asking makes both of them work.
    const redirectTo = new URL(AUTH_CALLBACK_PATH, window.location.origin);
    redirectTo.searchParams.set(DESTINATION_PARAM, NEW_PASSWORD_PATH);

    await supabaseBrowserAuth().resetPasswordForEmail(email, {
      redirectTo: redirectTo.toString(),
    });

    // The same answer either way, whether it worked or not. Saying "we could
    // not find that e-mail" confirms to anyone who asks who has an account —
    // and on a health platform the list of who is a patient is already
    // sensitive in itself.
    setSent(true);
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verifique seu e-mail</CardTitle>
          <CardDescription>
            Se existir uma conta com esse e-mail, o link para criar uma senha nova chega em
            instantes. Ele vale uma vez.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href={SIGN_IN_PATH}>Voltar para a entrada</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recuperar senha</CardTitle>
        <CardDescription>Enviamos um link para você criar uma senha nova.</CardDescription>
      </CardHeader>

      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(requestReset)} noValidate>
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

          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Enviando…' : 'Enviar o link'}
          </Button>

          <Link
            href={SIGN_IN_PATH}
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Voltar para a entrada
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
