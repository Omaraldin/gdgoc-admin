import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive/15 text-destructive border-destructive/20",
        outline:
          "text-foreground",
        // Status-specific variants matching Google's semantic colors
        success:
          "border-transparent bg-green-soft text-status-green",
        warning:
          "border-transparent bg-yellow-soft text-status-yellow",
        error:
          "border-transparent bg-red-soft text-status-red",
        info:
          "border-transparent bg-blue-soft text-status-blue",
        neutral:
          "border-transparent bg-neutral-soft text-status-neutral",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
