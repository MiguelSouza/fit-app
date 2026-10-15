import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const alertVariants = cva('w-full rounded-md border px-4 py-3 text-sm', {
  variants: {
    variant: {
      default: 'bg-muted text-foreground',
      destructive: 'border-destructive/50 bg-background text-destructive',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

/**
 * The shadcn/ui alert.
 *
 * `role="alert"` makes a screen reader announce the text the moment it shows up,
 * which is the point of a form warning: whoever does not see the red border has
 * to hear why it failed.
 */
function Alert({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Alert };
