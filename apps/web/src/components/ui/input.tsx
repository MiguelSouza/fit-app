import { type ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * The shadcn/ui text field. `aria-invalid` is what marks a field as wrong — React
 * Hook Form is what validates it — and the style follows the attribute instead of
 * a prop of its own, so the screen reader and the red border can never disagree.
 */
function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
