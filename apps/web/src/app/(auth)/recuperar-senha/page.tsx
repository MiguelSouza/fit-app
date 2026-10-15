import { type Metadata } from 'next';

import { PasswordResetForm } from '@/components/auth/password-reset-form';

export const metadata: Metadata = {
  title: 'Recuperar senha',
};

export default function PasswordResetPage() {
  return <PasswordResetForm />;
}
