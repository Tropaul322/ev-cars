"use client";

import { ArrowUp } from "lucide-react";
import { useState, type FormEvent } from "react";

export function Composer({
  placeholder = "Ask anything...",
  onSubmit,
  variant = "elevated",
  disabled = false,
}: {
  placeholder?: string;
  onSubmit?: (value: string) => void;
  variant?: "elevated" | "flat";
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  const handle = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit?.(value);
    setValue("");
  };

  return (
    <form
      onSubmit={handle}
      className={`w-full rounded-3xl bg-muted px-5 py-4 ${
        variant === "elevated" ? "shadow-[0_10px_30px_-10px_rgba(40,40,80,0.25)]" : ""
      }`}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full bg-transparent outline-none text-[15px] text-foreground placeholder:text-muted-foreground disabled:opacity-60"
      />
      <div className="flex items-center justify-end gap-2 mt-2">
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
}
