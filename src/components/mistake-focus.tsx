"use client";

import { createContext, createElement, useContext, useState } from "react";

// A mistake shows as a box on the working and as a note in the list. Hovering or focusing either
// one highlights both; tapping a note scrolls to its box (SPEC-study-views.md, mark-in-place).

const FocusContext = createContext<{ active: number | null; set: (n: number | null) => void }>({
  active: null,
  set: () => {},
});

/** The id of the box a note scrolls to. */
export const boxId = (number: number) => `mistake-box-${number}`;

export function MistakeFocusProvider({ children }: { children: React.ReactNode }) {
  const [active, set] = useState<number | null>(null);
  return <FocusContext.Provider value={{ active, set }}>{children}</FocusContext.Provider>;
}

type Props = {
  /** The mistake's number; a target with no number is just its element. */
  number: number | null;
  /** A box is drawn on the working; a note is an entry in the list. */
  role: "box" | "note";
  as: "div" | "span" | "li";
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  [data: `data-${string}`]: string | number | undefined;
};

/** Wraps a box or a note: highlights with its twin, and makes it reachable by keyboard. */
export function MistakeTarget({ number, role, as, children, className, style, ...data }: Props) {
  const { active, set } = useContext(FocusContext);
  if (number === null) return createElement(as, { className, style, ...data }, children);

  const on = () => set(number);
  const off = () => set(null);
  const toBox = () => document.getElementById(boxId(number))?.scrollIntoView({ block: "center" });

  return createElement(
    as,
    {
      ...data,
      id: role === "box" ? boxId(number) : undefined,
      className,
      style,
      tabIndex: 0,
      "aria-label": role === "box" ? `Mistake ${number}` : undefined,
      "data-active": active === number ? "true" : undefined,
      onMouseEnter: on,
      onMouseLeave: off,
      onFocus: on,
      onBlur: off,
      onClick: role === "note" ? toBox : undefined,
      onKeyDown:
        role === "note"
          ? (event: React.KeyboardEvent) => {
              if (event.key === "Enter") toBox();
            }
          : undefined,
    },
    children,
  );
}
