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
import { ApiError } from '@/lib/api/client';
import { registerProfessional } from '@/lib/api/professionals';
import { HOME_PATH } from '@/lib/routes';

/**
 * The bounds are the ones of `RegisterProfessionalRequest` in
 * `packages/contracts`, so the form refuses what the API would refuse and the
 * person is told in the field instead of in a red box after a round trip. The
 * API validates it again regardless: the panel is a client, not the gate
 * (CLAUDE.md rule 6).
 */
const firstAccessSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, { error: 'Informe seu nome completo.' })
    .max(120, { error: 'Use no máximo 120 caracteres.' }),

  councilNumber: z
    .string()
    .trim()
    .min(3, { error: 'Informe o número do seu conselho.' })
    .max(32, { error: 'Use no máximo 32 caracteres.' }),

  specialty: z.string().trim().max(120, { error: 'Use no máximo 120 caracteres.' }),
});

type FirstAccessValues = z.infer<typeof firstAccessSchema>;

/**
 * The first access of a professional: name, CRN and specialty (card I-01).
 *
 * It is the one screen that creates the profile, so it is the one screen a
 * professional sees before having one. What comes back from the API is the
 * identity the panel then works with, and the redirect brings the layout of
 * the panel back with the session **and** the profile in hand — hence the
 * `refresh()`, which makes the server render it again.
 */
export function FirstAccessForm() {
  const router = useRouter();
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const form = useForm<FirstAccessValues>({
    resolver: zodResolver(firstAccessSchema),
    defaultValues: { fullName: '', councilNumber: '', specialty: '' },
  });

  async function register(values: FirstAccessValues) {
    setFailure(undefined);

    try {
      await registerProfessional({
        fullName: values.fullName,
        councilNumber: values.councilNumber,
        // Nobody has to have one, and an empty field is not a specialty.
        ...(values.specialty === '' ? {} : { specialty: values.specialty }),
      });
    } catch (error) {
      // The message of the API is already pt-BR and carries no personal data,
      // so it can go on the screen as it is. Anything else gets the generic
      // sentence: the panel does not show what it cannot explain.
      setFailure(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível concluir seu cadastro agora. Tente novamente.',
      );

      return;
    }

    router.replace(HOME_PATH);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seu cadastro</CardTitle>
        <CardDescription>
          Falta pouco. Estes dados ficam no seu perfil e podem ser editados depois.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(register)} noValidate>
          {failure != null ? <Alert variant="destructive">{failure}</Alert> : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="fullName">Nome completo</Label>
            <Input
              id="fullName"
              autoComplete="name"
              autoFocus
              aria-invalid={form.formState.errors.fullName != null}
              {...form.register('fullName')}
            />
            <FieldError message={form.formState.errors.fullName?.message} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="councilNumber">Número do conselho (CRN)</Label>
            <Input
              id="councilNumber"
              placeholder="CRN-3 12345"
              aria-invalid={form.formState.errors.councilNumber != null}
              {...form.register('councilNumber')}
            />
            <FieldError message={form.formState.errors.councilNumber?.message} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="specialty">Especialidade (opcional)</Label>
            <Input
              id="specialty"
              placeholder="Nutrição esportiva"
              aria-invalid={form.formState.errors.specialty != null}
              {...form.register('specialty')}
            />
            <FieldError message={form.formState.errors.specialty?.message} />
          </div>

          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Salvando…' : 'Concluir cadastro'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
