import { type Metadata } from 'next';

import { InvitationList } from '@/components/identity/invitation-list';
import { InvitePatientForm } from '@/components/identity/invite-patient-form';
import { SectionHeader } from '@/components/painel/section';

export const metadata: Metadata = {
  title: 'Convites',
};

/**
 * "Convites": generate a link for a patient, and follow the ones already sent
 * (card I-02).
 *
 * The page is a server component with nothing in it: both halves talk to the
 * API from the browser, through the generated client with the session's token
 * (ADR 0007), and the session and the profile were already checked by the
 * layout of `(painel)`.
 */
export default function InvitesPage() {
  return (
    <>
      <SectionHeader
        title="Convites"
        description="Quem você chamou para a plataforma e ainda não entrou."
      />

      <InvitePatientForm />

      <InvitationList />
    </>
  );
}
