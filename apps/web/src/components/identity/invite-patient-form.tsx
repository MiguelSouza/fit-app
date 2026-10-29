'use client';

import { type CreatedInvitation } from '@fit-app/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
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
import { createInvitation, invitationsQuery } from '@/lib/api/invitations';
import { inviteLink } from '@/lib/routes';

/**
 * The bounds are the ones of `CreateInvitationRequest` in
 * `packages/contracts`, so the form refuses what the API would refuse and the
 * person is told in the field instead of after a round trip. The API validates
 * it again regardless: the panel is a client, not the gate (CLAUDE.md rule 6).
 *
 * Both fields are optional here as they are there, and an empty one is an
 * absence and not a short value — which is why the minimum is a `refine` and
 * not a `min`.
 */
const NAME_MAX = 120;
const CONTACT_MAX = 160;

function optionalText(min: number, max: number, tooShort: string) {
  return z
    .string()
    .trim()
    .max(max, { error: `Use no máximo ${String(max)} caracteres.` })
    .refine((value) => value === '' || value.length >= min, { error: tooShort });
}

const invitePatientSchema = z.object({
  name: optionalText(2, NAME_MAX, 'Use pelo menos 2 caracteres, ou deixe em branco.'),
  contact: optionalText(3, CONTACT_MAX, 'Use pelo menos 3 caracteres, ou deixe em branco.'),
});

type InvitePatientValues = z.infer<typeof invitePatientSchema>;

/**
 * "Convidar paciente": generates the link and shows it, with a button that
 * copies it (card I-02).
 *
 * The link appears **once**, right after the invitation is created, and that
 * is the product rule and not a shortcut: the API answers the token in that
 * single response and keeps only a hash of it, so neither the panel nor the
 * database can show the link again. Whoever loses it revokes the invitation
 * and creates another, which the list next door does.
 *
 * Nothing is persisted in the browser either — no `localStorage`, no query
 * cache: the token lives in this component's state and is gone with the next
 * navigation.
 */
export function InvitePatientForm() {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<CreatedInvitation | undefined>(undefined);

  const form = useForm<InvitePatientValues>({
    resolver: zodResolver(invitePatientSchema),
    defaultValues: { name: '', contact: '' },
  });

  const invite = useMutation({
    mutationFn: createInvitation,

    onSuccess: async (invitation) => {
      setCreated(invitation);
      form.reset();

      // The list next door has one more row now.
      await queryClient.invalidateQueries({ queryKey: invitationsQuery.queryKey });
    },
  });

  function submit(values: InvitePatientValues) {
    // An empty field is not a value: the contract leaves out what was not
    // filled in.
    invite.mutate({
      ...(values.name === '' ? {} : { name: values.name }),
      ...(values.contact === '' ? {} : { contact: values.contact }),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convidar paciente</CardTitle>
        <CardDescription>
          Gere um link e envie pelo WhatsApp. O link vale 14 dias, serve para uma pessoa só e
          aparece aqui uma única vez.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(submit)} noValidate>
          {invite.isError ? (
            <Alert variant="destructive">
              {invite.error instanceof ApiError
                ? invite.error.message
                : 'Não foi possível gerar o convite agora. Tente novamente.'}
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Nome (opcional)</Label>
              <Input
                id="name"
                autoComplete="off"
                placeholder="Como você chama a pessoa"
                aria-invalid={form.formState.errors.name != null}
                {...form.register('name')}
              />
              <FieldError message={form.formState.errors.name?.message} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="contact">Contato (opcional)</Label>
              <Input
                id="contact"
                autoComplete="off"
                placeholder="+55 11 90000-0000"
                aria-invalid={form.formState.errors.contact != null}
                {...form.register('contact')}
              />
              <FieldError message={form.formState.errors.contact?.message} />
            </div>
          </div>

          <Button type="submit" className="sm:self-start" disabled={invite.isPending}>
            {invite.isPending ? 'Gerando…' : 'Gerar link do convite'}
          </Button>
        </form>

        {created !== undefined ? <InviteLink token={created.token} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * The link that was just generated, and the button that copies it.
 *
 * The base is `location.origin`, the address the professional is already on:
 * the invitation page is a route of this panel, so there is nothing to
 * configure per environment and no way for the link to point at the wrong
 * host. It is read in the browser, inside the handler and the render of a
 * client component, which is the only place it exists.
 */
function InviteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const link = inviteLink(window.location.origin, token);

  async function copy() {
    setCopyFailed(false);

    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard permission, or an http origin that is not localhost. The
      // link is on the screen and selectable, so the person is not stuck.
      setCopyFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-4">
      <Label htmlFor="inviteLink">Link do convite</Label>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="inviteLink" readOnly value={link} className="font-mono text-xs" />

        <Button type="button" variant="outline" onClick={copy} className="sm:w-40">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? 'Copiado' : 'Copiar link'}
        </Button>
      </div>

      {/* Announced the moment it shows up: whoever is not looking at the box
          has to hear that the copy worked. */}
      <p role="status" className="text-xs text-muted-foreground">
        {copyFailed
          ? 'Não foi possível copiar automaticamente. Selecione o link e copie.'
          : 'Este link aparece uma única vez. Envie agora pelo WhatsApp.'}
      </p>
    </div>
  );
}
