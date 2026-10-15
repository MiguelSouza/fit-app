import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins Tailwind classes resolving the conflicts: the last one wins.
 *
 * It is the `cn` shadcn/ui generates, and every component in `components/ui`
 * uses it so the caller can override the default style. Without it,
 * `<Button className="bg-red-500">` ends up with two background colours in the
 * class list and the winner is whichever comes later in the stylesheet, not
 * whoever wrote it.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
