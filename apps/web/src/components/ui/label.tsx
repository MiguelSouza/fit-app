'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { type ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * The shadcn/ui label. The Radix primitive is here for one detail, and it is the
 * one that matters: clicking the label focuses the field even when the control is
 * not a native `<input>`.
 */
function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'text-sm font-medium leading-none select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
