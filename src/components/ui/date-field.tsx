"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { parseDateInputValue, toDateInputValue } from "@/lib/age";
import { cn } from "@/lib/utils";

/**
 * A date input with the app's own calendar instead of the browser's.
 *
 * The native picker was unusable for the one date this app actually asks for:
 * it opens on the current month, so a 16-year-old choosing a date of birth had
 * to page back ~190 months one arrow at a time. It also renders in the
 * browser's chrome - a blue Chrome popup in the middle of a Court Ink form.
 * This panel opens directly under the field, carries month and year selects so
 * any date is two taps away, and is styled from the design tokens.
 *
 * The underlying control stays `<input type="date">` on purpose:
 * - typing a date still works, with the platform's own segment behaviour and
 *   locale ordering (dd/mm/yyyy here, mm/dd/yyyy in the US);
 * - the value stays a real `YYYY-MM-DD`, so nothing downstream has to parse a
 *   display string;
 * - on a phone, tapping the field still gets the native wheel, which beats any
 *   grid on a small screen.
 * Only the *picker* is replaced: the native indicator is hidden and our own
 * trigger opens the panel below. (Firefox has no way to hide its indicator, so
 * there it keeps its own button alongside ours - harmless, both set the same
 * value.)
 *
 * Every date is handled at UTC midnight, matching `@/lib/age` - the same
 * reason that module gives: the day a player picks must not shift by one
 * depending on which side of the world they picked it from.
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  defaultViewDate,
  className,
  ...inputProps
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "min" | "max"> & {
  id: string;
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  /** Earliest selectable day, inclusive. */
  min?: Date;
  /** Latest selectable day, inclusive. */
  max?: Date;
  /** Month the calendar opens on before anything is chosen. */
  defaultViewDate?: Date;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelStyle = useAnchoredPosition(wrapperRef, panelRef, open);

  const fallbackView = useMemo(
    () => startOfUtcMonth(defaultViewDate ?? value ?? utcToday()),
    [defaultViewDate, value],
  );
  const [viewMonth, setViewMonth] = useState(fallbackView);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Clicking anywhere outside dismisses the panel. `pointerdown` rather than
  // `click` so it closes on press, the way every other menu on the platform
  // does, instead of waiting for the release. The panel is checked separately
  // from the field because it renders in a portal - in the DOM it is not
  // inside the wrapper at all.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  /**
   * Escape, wherever focus happens to be.
   *
   * This was a handler on the wrapper, which only saw keys from inside it -
   * and using the month or year select moves focus out of the panel, so after
   * picking a month Escape stopped closing anything. While the panel is open
   * there is nothing else Escape could reasonably mean, so it is handled for
   * the whole document.
   */
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  function openPanel() {
    // Always start from what's currently chosen, so reopening after picking a
    // date doesn't throw the player back to the default month.
    setViewMonth(startOfUtcMonth(value ?? defaultViewDate ?? utcToday()));
    setOpen(true);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        id={id}
        type="date"
        value={value ? toDateInputValue(value) : ""}
        min={min ? toDateInputValue(min) : undefined}
        max={max ? toDateInputValue(max) : undefined}
        onChange={(event) => onChange(parseDateInputValue(event.target.value))}
        className={cn(
          "pr-11 [&::-webkit-calendar-picker-indicator]:hidden",
          className,
        )}
        {...inputProps}
      />

      <button
        ref={triggerRef}
        type="button"
        // Labelled by what it does, not by the current value: the value is
        // already announced by the input this sits inside.
        aria-label="Open calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : openPanel())}
        className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <CalendarDays className="size-4" aria-hidden />
      </button>

      {/* Portalled to <body>, not rendered in place: every screen that uses a
          date field sits inside a Card or a step panel, and an absolutely
          positioned child gets clipped the moment one of those ancestors has
          `overflow: hidden` (or simply ends above the panel). A fixed-position
          portal is the only placement that can't be cropped by a container it
          no longer lives in. */}
      {open &&
        createPortal(
          <CalendarPanel
            id={panelId}
            panelRef={panelRef}
            style={panelStyle}
            value={value}
            viewMonth={viewMonth}
            onViewMonthChange={setViewMonth}
            min={min}
            max={max}
            onSelect={(date) => {
              onChange(date);
              close();
            }}
            onClear={() => {
              onChange(undefined);
              close();
            }}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * Pins the panel under the field (or above it, when the viewport has no room
 * below) and keeps it there while the page scrolls or resizes.
 *
 * Measured in a layout effect rather than estimated: the panel's height
 * depends on its own content, and placing it before the browser paints is what
 * keeps it from visibly jumping into position. It starts hidden so the
 * pre-measurement frame is never shown.
 */
function useAnchoredPosition(
  anchorRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  open: boolean,
): React.CSSProperties {
  // Hidden with opacity rather than `visibility: hidden` for the one
  // pre-measurement frame: a `visibility: hidden` element cannot take focus,
  // and the panel focuses a day as soon as it mounts.
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    opacity: 0,
  });

  useLayoutEffect(() => {
    // Nothing to reset when closed: the panel unmounts, and the next open
    // re-measures in this same layout effect - before the browser paints, so
    // the stale position from last time is never on screen.
    if (!open) return;

    function place() {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!anchor || !panel) return;

      const GAP = 8;
      const MARGIN = 12;
      const below = anchor.bottom + GAP;
      const fitsBelow = below + panel.height <= window.innerHeight - MARGIN;

      setStyle({
        position: "fixed",
        top: fitsBelow
          ? below
          : Math.max(MARGIN, anchor.top - GAP - panel.height),
        left: Math.min(
          Math.max(MARGIN, anchor.left),
          Math.max(MARGIN, window.innerWidth - panel.width - MARGIN),
        ),
        opacity: 1,
      });
    }

    place();
    // `true` for the capture phase: the field can sit inside its own scroll
    // container, whose scroll never reaches window in the bubble phase.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef, panelRef]);

  return style;
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

const WEEKDAYS = [
  { short: "S", long: "Sunday" },
  { short: "M", long: "Monday" },
  { short: "T", long: "Tuesday" },
  { short: "W", long: "Wednesday" },
  { short: "T", long: "Thursday" },
  { short: "F", long: "Friday" },
  { short: "S", long: "Saturday" },
];

const MONTH_FORMATTER = new Intl.DateTimeFormat("en", {
  month: "long",
  timeZone: "UTC",
});
/**
 * The select sits between two arrow buttons and a year select, which leaves it
 * too narrow for "September" - it truncated to "Septe...". The full name is
 * still what the live region announces.
 */
const SHORT_MONTH_FORMATTER = new Intl.DateTimeFormat("en", {
  month: "short",
  timeZone: "UTC",
});
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
  dateStyle: "full",
  timeZone: "UTC",
});

function CalendarPanel({
  id,
  panelRef,
  style,
  value,
  viewMonth,
  onViewMonthChange,
  min,
  max,
  onSelect,
  onClear,
}: {
  id: string;
  panelRef: React.RefObject<HTMLDivElement | null>;
  style: React.CSSProperties;
  value: Date | undefined;
  viewMonth: Date;
  onViewMonthChange: (month: Date) => void;
  min?: Date;
  max?: Date;
  onSelect: (date: Date) => void;
  onClear: () => void;
}) {
  const labelId = `${id}-label`;
  const today = useMemo(() => utcToday(), []);

  /**
   * The day arrow keys move around. Starts on the chosen day, or on the first
   * selectable day of the month in view - never on nothing, so the grid always
   * has exactly one tab stop (a roving tabindex, as a grid requires).
   */
  const [focusedDate, setFocusedDate] = useState(
    () => value ?? clampToMonth(today, viewMonth, min, max),
  );
  const gridRef = useRef<HTMLDivElement>(null);
  // Set when a key moves the focus, so the effect below only pulls focus into
  // the grid on deliberate navigation - never while someone is typing in the
  // field with the panel open.
  const shouldFocusDay = useRef(false);

  const days = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  const focusFocusedDay = useCallback(() => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>('[data-focused="true"]')
      ?.focus();
  }, []);

  /**
   * Move focus into the grid as soon as the panel opens.
   *
   * Without this the trigger button keeps focus, and every key meant for the
   * calendar - arrows, Enter, Escape - lands on the button instead: arrows do
   * nothing, Enter re-toggles the panel, and Escape never reaches the handler
   * below because the button sits outside this element.
   */
  useEffect(() => {
    focusFocusedDay();
  }, [focusFocusedDay]);

  useEffect(() => {
    if (!shouldFocusDay.current) return;
    shouldFocusDay.current = false;
    focusFocusedDay();
  }, [focusedDate, focusFocusedDay]);

  function moveFocus(next: Date) {
    if (isBefore(next, min) || isAfter(next, max)) return;
    shouldFocusDay.current = true;
    setFocusedDate(next);
    if (!isSameUtcMonth(next, viewMonth)) onViewMonthChange(startOfUtcMonth(next));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addUtcDays(focusedDate, -1),
      ArrowRight: () => addUtcDays(focusedDate, 1),
      ArrowUp: () => addUtcDays(focusedDate, -7),
      ArrowDown: () => addUtcDays(focusedDate, 7),
      Home: () => addUtcDays(focusedDate, -focusedDate.getUTCDay()),
      End: () => addUtcDays(focusedDate, 6 - focusedDate.getUTCDay()),
      PageUp: () => addUtcMonths(focusedDate, -1),
      PageDown: () => addUtcMonths(focusedDate, 1),
    };

    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveFocus(move());
  }

  const years = useMemo(() => yearRange(viewMonth, min, max), [viewMonth, min, max]);

  return (
    <div
      id={id}
      ref={panelRef}
      role="dialog"
      aria-label="Choose a date"
      onKeyDown={onKeyDown}
      style={style}
      className="animate-pop z-50 w-[19.5rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl"
    >
      <div className="flex items-center gap-1.5">
        <ArrowButton
          label="Previous month"
          disabled={isBefore(endOfUtcMonth(addUtcMonths(viewMonth, -1)), min)}
          onClick={() => onViewMonthChange(addUtcMonths(viewMonth, -1))}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </ArrowButton>

        <div className="flex min-w-0 flex-1 gap-1.5">
          <NativeSelect
            aria-label="Month"
            className="h-9 text-[0.8rem]"
            value={viewMonth.getUTCMonth()}
            onChange={(event) =>
              onViewMonthChange(
                utcDate(viewMonth.getUTCFullYear(), Number(event.target.value), 1),
              )
            }
          >
            {Array.from({ length: 12 }, (_, month) => (
              <option key={month} value={month}>
                {SHORT_MONTH_FORMATTER.format(utcDate(2000, month, 1))}
              </option>
            ))}
          </NativeSelect>

          <NativeSelect
            aria-label="Year"
            className="h-9 text-[0.8rem]"
            value={viewMonth.getUTCFullYear()}
            onChange={(event) =>
              onViewMonthChange(
                utcDate(Number(event.target.value), viewMonth.getUTCMonth(), 1),
              )
            }
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </NativeSelect>
        </div>

        <ArrowButton
          label="Next month"
          disabled={isAfter(startOfUtcMonth(addUtcMonths(viewMonth, 1)), max)}
          onClick={() => onViewMonthChange(addUtcMonths(viewMonth, 1))}
        >
          <ChevronRight className="size-4" aria-hidden />
        </ArrowButton>
      </div>

      {/* The month in view, for a screen reader that can't see the two selects
          change together. */}
      <p id={labelId} aria-live="polite" className="sr-only">
        {MONTH_FORMATTER.format(viewMonth)} {viewMonth.getUTCFullYear()}
      </p>

      <div ref={gridRef} role="grid" aria-labelledby={labelId} className="mt-3">
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((weekday, index) => (
            <abbr
              key={index}
              role="columnheader"
              title={weekday.long}
              aria-label={weekday.long}
              className="py-1 text-center text-[0.7rem] font-medium text-muted-foreground no-underline"
            >
              {weekday.short}
            </abbr>
          ))}
        </div>

        {chunk(days, 7).map((week) => (
          <div role="row" key={week[0].toISOString()} className="grid grid-cols-7">
            {week.map((day) => {
              const outside = !isSameUtcMonth(day, viewMonth);
              const selected = value ? isSameUtcDay(day, value) : false;
              const isToday = isSameUtcDay(day, today);
              const focused = isSameUtcDay(day, focusedDate);
              const disabled = isBefore(day, min) || isAfter(day, max);

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  role="gridcell"
                  disabled={disabled}
                  aria-selected={selected}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={FULL_DATE_FORMATTER.format(day)}
                  data-focused={focused}
                  // Roving tabindex: one stop for the whole grid, then arrow
                  // keys from there.
                  tabIndex={focused ? 0 : -1}
                  onClick={() => onSelect(day)}
                  onFocus={() => setFocusedDate(day)}
                  className={cn(
                    "mx-auto flex size-9 items-center justify-center rounded-lg text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    !selected && "hover:bg-muted",
                    outside && !selected && "text-muted-foreground/50",
                    isToday && !selected && "font-semibold text-brand-ink",
                    selected &&
                      "bg-brand-strong font-semibold text-brand-foreground",
                    disabled &&
                      "pointer-events-none text-muted-foreground/30 line-through",
                  )}
                >
                  {day.getUTCDate()}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-end border-t border-border pt-2">
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-input bg-card text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// UTC date helpers. Kept local and pure - every one of them takes and returns
// a UTC-midnight Date, so no calculation here can drift by a day.
// ---------------------------------------------------------------------------

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function utcToday(): Date {
  const now = new Date();
  return utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function startOfUtcMonth(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function endOfUtcMonth(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
}

function addUtcDays(date: Date, days: number): Date {
  return utcDate(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
  );
}

/**
 * Month arithmetic that clamps instead of overflowing: a month before 31 March
 * is 28/29 February, not 2 or 3 March (which is what `setMonth` would give).
 */
function addUtcMonths(date: Date, months: number): Date {
  const target = utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
  const lastDay = endOfUtcMonth(target).getUTCDate();
  return utcDate(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    Math.min(date.getUTCDate(), lastDay),
  );
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function isSameUtcMonth(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

function isBefore(date: Date, bound: Date | undefined): boolean {
  return bound !== undefined && date.getTime() < bound.getTime();
}

function isAfter(date: Date, bound: Date | undefined): boolean {
  return bound !== undefined && date.getTime() > bound.getTime();
}

/** The 6×7 block a month is drawn in, starting on the Sunday on or before the
 * 1st. Always 42 cells, so the panel never changes height between months. */
function buildMonthGrid(viewMonth: Date): Date[] {
  const first = startOfUtcMonth(viewMonth);
  const start = addUtcDays(first, -first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => addUtcDays(start, index));
}

/** Where the keyboard starts when nothing is chosen yet: today if it's in the
 * month on screen and selectable, otherwise that month's first selectable day. */
function clampToMonth(
  today: Date,
  viewMonth: Date,
  min: Date | undefined,
  max: Date | undefined,
): Date {
  const candidate = isSameUtcMonth(today, viewMonth)
    ? today
    : startOfUtcMonth(viewMonth);
  if (isBefore(candidate, min)) return min as Date;
  if (isAfter(candidate, max)) return max as Date;
  return candidate;
}

/**
 * Years offered in the picker, newest first - a date of birth is far more
 * likely to be recent than a century back, and it saves scrolling the list.
 */
function yearRange(
  viewMonth: Date,
  min: Date | undefined,
  max: Date | undefined,
): number[] {
  const currentYear = utcToday().getUTCFullYear();
  const first = min?.getUTCFullYear() ?? currentYear - 100;
  const last = max?.getUTCFullYear() ?? currentYear + 10;
  // The month in view can sit outside [min, max] (a restored draft, say), and
  // a <select> whose value isn't among its options renders blank.
  const from = Math.min(first, viewMonth.getUTCFullYear());
  const to = Math.max(last, viewMonth.getUTCFullYear());
  return Array.from({ length: to - from + 1 }, (_, i) => to - i);
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );
}
