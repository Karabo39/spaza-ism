import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex min-h-11 sm:min-h-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        secondary:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        outline:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        ghost:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        danger:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        link: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
      },
      size: {
        sm: "h-11 sm:h-8 px-3 text-xs",
        md: "h-11 sm:h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-11 w-11 min-w-11 sm:min-w-0 sm:h-10 sm:w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    if (asChild) {
      // Radix Slot requires exactly one child element; don't inject a loader.
      return (
        <Slot
          data-app-button=""
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        >
          {children}
        </Slot>
      );
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
