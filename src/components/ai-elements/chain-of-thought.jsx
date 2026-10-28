// Adapted from Vercel AI Elements. Modified for this starter.
// Copyright 2023 Vercel, Inc. Apache-2.0; see LICENSE and THIRD_PARTY_NOTICES.md.
"use client";
import { memo } from "react";
import { BrainIcon, DotIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// One accessible root owns both the trigger and its associated content panel.
export const ChainOfThought = memo(function ChainOfThought({ className, open, onOpenChange, children, ...props }) {
  return <Collapsible open={open} onOpenChange={onOpenChange} className={cn("not-prose flex w-full flex-col gap-2", className)} {...props}>{children}</Collapsible>;
});

export function ChainOfThoughtHeader({ className, children, ...props }) {
  return (
    <CollapsibleTrigger className={cn("flex w-full items-center gap-2 text-left text-sm text-muted-foreground", className)} {...props}>
      <BrainIcon aria-hidden="true" />
      <span>{children || "Analysis steps"}</span>
    </CollapsibleTrigger>
  );
}

export function ChainOfThoughtContent({ className, ...props }) {
  return <CollapsibleContent className={cn("flex flex-col gap-3 text-foreground", className)} {...props} />;
}

export const ChainOfThoughtStep = memo(function ChainOfThoughtStep({ className, icon: Icon = DotIcon, label, description, status = "complete", children, ...props }) {
  return (
    <div className={cn("flex gap-2 text-sm", status === "active" ? "text-foreground" : "text-muted-foreground", className)} {...props}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
        {children}
      </div>
    </div>
  );
});
