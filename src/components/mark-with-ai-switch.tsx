"use client";

import { Lock } from "lucide-react";
import { useId } from "react";

import { Switch } from "@/components/ui/switch";
import { switchView } from "@/lib/marking/plan";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Questions this submit covers, and how many of them have an official solution. */
  total: number;
  official: number;
  disabled?: boolean;
};

/**
 * "Mark with AI now" (SPEC-study-views.md, mark-on-official), placed beside a submit button.
 * Greyed out and locked when every question is marked against its official solution.
 */
export function MarkWithAiSwitch({ checked, onCheckedChange, total, official, disabled }: Props) {
  const id = useId();
  const view = switchView({ checked, total, official });
  const note = `${id}-note`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={view.locked ? false : checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled || view.locked}
          aria-describedby={note}
        />
        <label htmlFor={id} className="text-sm font-medium">
          Mark with AI now
        </label>
        {view.locked ? <Lock aria-hidden className="text-muted-foreground size-3.5" /> : null}
      </div>
      <p id={note} className="text-muted-foreground text-xs">
        {view.text}
        {view.scope ? ` · ${view.scope}` : ""}
      </p>
    </div>
  );
}
