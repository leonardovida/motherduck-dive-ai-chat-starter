// Adapted from Vercel AI Elements. Modified for this starter.
// Copyright 2023 Vercel, Inc. Apache-2.0; see LICENSE and THIRD_PARTY_NOTICES.md.
"use client";

import { createContext, useContext, useState } from "react";
import { ArrowUpIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DraftContext = createContext(null);

// Text-only on purpose: the server accepts text, not files or microphone input.
export function PromptInput({ className, onSubmit, children, ...props }) {
  const [text, setText] = useState("");
  const submit = (event) => {
    event.preventDefault();
    const question = text.trim();
    if (!question) return;
    try {
      const sent = onSubmit({ text: question }, event);
      setText("");
      // Keep the draft available if transport fails, without overwriting new typing.
      Promise.resolve(sent).catch(() => setText((current) => current || question));
    } catch {
      // A synchronous validation failure keeps the existing draft.
    }
  };
  return (
    <DraftContext.Provider value={{ text, setText }}>
      <form className={cn("w-full", className)} onSubmit={submit} {...props}>
        <InputGroup className="overflow-hidden">{children}</InputGroup>
      </form>
    </DraftContext.Provider>
  );
}

export function PromptInputBody({ className, ...props }) {
  return <div className={cn("contents", className)} {...props} />;
}

export function PromptInputTextarea({ className, onChange, onKeyDown, ...props }) {
  const { text, setText } = useContext(DraftContext);
  return (
    <InputGroupTextarea
      name="message"
      aria-label="Your question"
      className={cn("field-sizing-content max-h-48 min-h-16", className)}
      maxLength={12000}
      value={text}
      onChange={(event) => { setText(event.target.value); onChange?.(event); }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const submit = event.currentTarget.form?.querySelector('button[type="submit"]');
          if (!submit?.disabled) event.currentTarget.form?.requestSubmit();
        }
      }}
      {...props}
    />
  );
}

export function PromptInputFooter({ className, ...props }) {
  return <InputGroupAddon align="block-end" className={cn("justify-between gap-1", className)} {...props} />;
}

export function PromptInputTools({ className, ...props }) {
  return <div className={cn("flex items-center gap-1", className)} {...props} />;
}

export function PromptInputSubmit({ status, disabled, children, ...props }) {
  const { text } = useContext(DraftContext);
  const busy = status === "submitted" || status === "streaming";
  return (
    <Button type="submit" size="icon-sm" disabled={disabled || busy || !text.trim()} {...props}>
      {children || (busy ? <Loader2Icon className="animate-spin" /> : <ArrowUpIcon />)}
    </Button>
  );
}

export const PromptInputSelect = Select;
export const PromptInputSelectTrigger = SelectTrigger;
export function PromptInputSelectContent({ children, ...props }) {
  return <SelectContent {...props}><SelectGroup>{children}</SelectGroup></SelectContent>;
}
export const PromptInputSelectItem = SelectItem;
export const PromptInputSelectValue = SelectValue;
