"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex items-center gap-1 border-b border-line", className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative -mb-px px-3 py-2.5 font-sans text-sm font-medium text-ink-3",
        "border-b-2 border-transparent",
        "transition-colors duration-(--duration-fast) ease-(--ease-out-expo)",
        "hover:text-ink",
        "data-[state=active]:text-ink data-[state=active]:border-accent",
        "disabled:opacity-50 disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("pt-5 motion-safe:data-[state=active]:u-fade", className)}
      {...props}
    />
  );
}
