import { type ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * A placeholder while the data has not arrived. It is decoration, so it leaves the
 * accessibility tree: a screen reader announces the `aria-busy` of the region
 * that is loading, not a handful of rectangles.
 */
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
