import { type Metadata } from 'next';

import { SectionHeader, SectionPlaceholder } from '@/components/painel/section';

export const metadata: Metadata = {
  title: 'Ajustes',
};

export default function SettingsPage() {
  return (
    <>
      <SectionHeader
        title="Ajustes"
        description="Seu perfil profissional, sua organização e suas preferências."
      />

      <SectionPlaceholder>
        O perfil e a organização são do módulo identity. Trocar a senha já funciona pela tela de
        recuperação, na entrada do painel.
      </SectionPlaceholder>
    </>
  );
}
