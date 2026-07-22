import { useEffect, useId, useRef, useState } from "react";

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

interface ChoiceSelectProps<T extends string> {
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

export function ChoiceSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = ""
}: ChoiceSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function move(direction: -1 | 1) {
    const next = (selectedIndex + direction + options.length) % options.length;
    onChange(options[next].value);
    setOpen(true);
  }

  return (
    <div ref={rootRef} className={`choice-select${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
      <button
        className="choice-select__trigger"
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            move(event.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        <span>{selected?.label ?? value}</span><i aria-hidden="true" />
      </button>
      <div className="choice-select__menu" id={listId} role="listbox" aria-hidden={!open}>
        {options.map((option) => (
          <button
            type="button"
            role="option"
            aria-selected={option.value === value}
            tabIndex={open ? 0 : -1}
            key={option.value}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
          >
            <span>{option.label}</span><i aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
