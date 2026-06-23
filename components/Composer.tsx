"use client";

import { ArrowUp } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
} from "react";

export type ComposerHandle = {
  focus: () => void;
  appendText: (text: string) => void;
};

export const Composer = forwardRef<
  ComposerHandle,
  {
    placeholder?: string;
    onSubmit?: (value: string) => void;
    variant?: "elevated" | "flat";
    disabled?: boolean;
    autoFocus?: boolean;
  }
>(function Composer(
  {
    placeholder = "Ask anything...",
    onSubmit,
    variant = "elevated",
    disabled = false,
    autoFocus = false,
  },
  ref,
) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus() {
      textareaRef.current?.focus();
    },
    appendText(text: string) {
      setValue((current) => current + text);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  }));

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  const handle = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit?.(value);
    setValue("");
  };

  const focusInput = () => {
    if (!disabled) textareaRef.current?.focus();
  };

  return (
    <form
      onSubmit={handle}
      onClick={focusInput}
      className={`w-full cursor-text rounded-3xl bg-muted px-5 py-4 ${
        variant === "elevated"
          ? "shadow-[0_10px_30px_-10px_rgba(40,40,80,0.25)]"
          : ""
      }`}
    >
      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="scrollbar-none w-full min-h-[24px] max-h-40 resize-none overflow-y-auto bg-transparent outline-none text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground disabled:opacity-60"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="submit"
          className="size-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50"
          aria-label="Send"
          disabled={!value.trim() || disabled}
        >
          <ArrowUp className="size-4" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
});
