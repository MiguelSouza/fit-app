'use client';

import { Inbox, ListChecks, LogOut, MailPlus, Settings, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { HOME_PATH, INVITES_PATH, PATIENTS_PATH, SETTINGS_PATH, SIGN_OUT_PATH } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * The menu of the panel, in the order card F-13 asks for.
 *
 * "Fila" is the home page and not a route of its own: it is the first thing a
 * professional opens — who needs attention today — so it is `/`.
 */
const SECTIONS = [
  { href: HOME_PATH, label: 'Fila', icon: ListChecks },
  { href: PATIENTS_PATH, label: 'Pacientes', icon: Users },
  { href: INVITES_PATH, label: 'Convites', icon: MailPlus },
  { href: SETTINGS_PATH, label: 'Ajustes', icon: Settings },
] as const;

/**
 * The side menu.
 *
 * It is a client component for one reason: `usePathname`, to mark where the
 * person is. The account's e-mail comes from above, from the layout, which has
 * already asked Auth who is signed in — and it stays in the browser of whoever
 * owns it, going through no log at all (`CLAUDE.md`, "Saúde e LGPD").
 */
export function SideMenu({ accountEmail }: { accountEmail: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Seções do painel"
      className="flex w-60 shrink-0 flex-col gap-6 border-r bg-card px-3 py-4"
    >
      <Link href={HOME_PATH} className="flex items-center gap-2 px-2">
        <Inbox className="size-5 text-muted-foreground" aria-hidden="true" />
        <span className="font-semibold tracking-tight">fit-app</span>
      </Link>

      <ul className="flex flex-1 flex-col gap-1">
        {SECTIONS.map(({ href, label, icon: Icon }) => {
          const current = pathname === href;

          return (
            <li key={href}>
              <Link
                href={href}
                // `aria-current` is what tells a screen reader which item is
                // the current one; the background colour says the same thing to
                // whoever can see it.
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
                  current
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 border-t pt-3">
        <span className="truncate px-2 text-xs text-muted-foreground" title={accountEmail}>
          {accountEmail}
        </span>

        {/* `POST`, and not a link: see the comment in `app/auth/sign-out`. */}
        <form method="post" action={SIGN_OUT_PATH}>
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
            <LogOut aria-hidden="true" />
            Sair
          </Button>
        </form>
      </div>
    </nav>
  );
}
