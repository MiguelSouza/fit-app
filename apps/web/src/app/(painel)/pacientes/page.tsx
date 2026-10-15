import { type Metadata } from 'next';

import { SectionHeader, SectionPlaceholder } from '@/components/painel/section';

export const metadata: Metadata = {
  title: 'Pacientes',
};

export default function PatientsPage() {
  return (
    <>
      <SectionHeader
        title="Pacientes"
        description="Quem você acompanha, com vínculo ativo e consentimento vigente."
      />

      <SectionPlaceholder>
        A lista de pacientes e a ficha de cada um vêm do módulo identity, que é quem guarda o
        vínculo e o consentimento — e quem registra o acesso quando uma ficha é aberta.
      </SectionPlaceholder>
    </>
  );
}
