import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[color,background-color,border-color,box-shadow] duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // Brand surface. Text is --primary-foreground (near-black) because
        // white on brand-500 only reaches 3.1:1.
        default:
          'bg-brand-500 font-semibold text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_6px_20px_-8px_var(--brand-500)] hover:bg-brand-500/90 active:scale-[0.98]',
        destructive:
          'bg-destructive font-semibold text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-destructive/90 active:scale-[0.98]',
        outline:
          'border border-border bg-surface-muted text-foreground hover:border-border-strong hover:bg-surface-muted/70 active:scale-[0.98]',
        secondary:
          'border border-border bg-surface-muted text-secondary-foreground hover:border-border-strong hover:bg-surface-muted/70',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        link: 'text-brand-500 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
