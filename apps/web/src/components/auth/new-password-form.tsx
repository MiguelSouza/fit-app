'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
import { HOME_PATH } from '@/lib/routes';
import { supabaseBrowserAuth } from '@/lib/supabase/browser';

/** The minimum is the one in `supabase/config.toml` (`minimum_password_length`). */
const MINIMUM_PASSWORD_LENGTH = 8;

const newPasswordSchema = z
  .object({
    password: z.string().min(MINIMUM_PASSWORD_LENGTH, {
      error: `A senha precisa ter ao menos ${MINIMUM_PASSWORD_LENGTH} caracteres.`,
    }),
    confirmation: z.string(),
  })
  .refine((values) => values.password === values.confirmation, {
    error: 'As duas senhas não são iguais.',
    path: ['confirmation'],
  });

type NewPasswordValues = z.infer<typeof newPasswordSchema>;

/**
 * Changing the password using the session the recovery link created.
 */
export function NewPasswordForm() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  const form = useForm<NewPasswordValues>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '', confirmation: '' },
  });

  async function changePassword({ password }: NewPasswordValues) {
    setFailed(false);

    const { error } = await supabaseBrowserAuth().updateUser({ password });

    if (error) {
      // Auth refuses, for instance, a password that is already the current
      // one. The reason does not go to the console: the error comes with the
      // user data inside it.
      setFailed(true);
      return;
    }

    router.replace(HOME_PATH);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Criar uma senha nova</CardTitle>
        <CardDescription>
          Ao menos {MINIMUM_PASSWORD_LENGTH} caracteres. Depois de salvar você entra direto.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit(changePassword)}
          noValidate
        >
          {failed ? (
            <Alert variant="destructive">
              Não foi possível salvar essa senha. Tente outra, ou peça um link novo.
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Senha nova</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              aria-invalid={form.formState.errors.password != null}
              {...form.register('password')}
            />
            <FieldError message={form.formState.errors.password?.message} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmation">Repita a senha nova</Label>
            <Input
              id="confirmation"
              type="password"
              autoComplete="new-password"
              aria-invalid={form.formState.errors.confirmation != null}
              {...form.register('confirmation')}
            />
            <FieldError message={form.formState.errors.confirmation?.message} />
          </div>

          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Salvando…' : 'Salvar a senha'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
