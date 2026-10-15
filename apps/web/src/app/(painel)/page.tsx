import { type Metadata } from 'next';

import { IdentityCard } from '@/components/painel/identity-card';
import { SectionHeader, SectionPlaceholder } from '@/components/painel/section';

export const metadata: Metadata = {
  title: 'Fila',
};

/**
 * The home page of the panel: the queue of who needs attention.
 *
 * The queue itself comes from the alerts of the `insights` module, which do not
 * exist yet. What is already standing is the path to the API — the identity card
 * below is `GET /v1/me`, answered with the token of this session.
 */
export default function HomePage() {
  return (
    <>
      <SectionHeader title="Fila" description="Quem precisa de atenção hoje, e por quê." />

      <IdentityCard />

      <SectionPlaceholder>
        A fila lista os alertas abertos dos seus pacientes, do mais urgente para o menos. Ela entra
        com as regras de alerta do módulo insights.
      </SectionPlaceholder>
    </>
  );
}
