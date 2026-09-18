"use client";

import { cn } from "@/lib/utils";

export interface ChipOption {
  value: string;
  label: string;
  description?: string;
}

interface ChipGroupProps {
  options: ChipOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
}

/**
 * Tappable chip picker - used by onboarding for single/multi-select
 * questions and by Train for skill selection. Fits the mobile-first,
 * non-survey-feeling flow better than native <select>/checkbox lists.
 */
export function ChipGroup({ options, value, onChange, multiple }: ChipGroupProps) {
  const selectedValues = Array.isArray(value) ? value : value ? [value] : [];

  function handleToggle(optionValue: string) {
    if (multiple) {
      const next = selectedValues.includes(optionValue)
        ? selectedValues.filter((v) => v !== optionValue)
        : [...selectedValues, optionValue];
      onChange(next);
    } else {
      onChange(optionValue);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = selectedValues.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => handleToggle(option.value)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-muted",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
