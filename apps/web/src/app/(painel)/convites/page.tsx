import { type Metadata } from 'next';

import { SectionHeader, SectionPlaceholder } from '@/components/painel/section';

export const metadata: Metadata = {
  title: 'Convites',
};

export default function InvitesPage() {
  return (
    <>
      <SectionHeader
        title="Convites"
        description="Quem você chamou para a plataforma e ainda não entrou."
      />

      <SectionPlaceholder>
        Convidar um paciente, acompanhar o convite e reenviá-lo são casos de uso do módulo identity.
      </SectionPlaceholder>
    </>
  );
}
