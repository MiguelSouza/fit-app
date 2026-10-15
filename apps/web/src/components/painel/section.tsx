import { type ReactNode } from 'react';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';

/**
 * The header of a section of the panel: the `<h1>` of the page and one line
 * saying what it is. One page, one `h1`.
 */
export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </header>
  );
}

/**
 * Where a section will show up, while it does not exist yet.
 *
 * The skeleton of the panel (card F-13) delivers the four routes of the menu
 * and no data: the queue, the patient list, the invitations and the settings
 * come from the cards of each module. A route answering "nothing here yet"
 * beats a menu item that leads to a 404 — and it disappears the day the content
 * arrives.
 */
export function SectionPlaceholder({ children }: { children: ReactNode }) {
  return (
    <Card className="items-center gap-2 border-dashed py-10 text-center shadow-none">
      <CardTitle className="font-medium">Ainda não tem nada aqui</CardTitle>
      <CardDescription className="max-w-prose">{children}</CardDescription>
    </Card>
  );
}
