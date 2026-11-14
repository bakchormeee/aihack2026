"use client";

import { MasteryOverTime, type MasteryOverTimeProps } from "@/components/charts/mastery-over-time";

/** Client wrapper: the chart is client-side only, and the page passes plain data. */
export function ProgressChart(props: MasteryOverTimeProps) {
  return <MasteryOverTime {...props} />;
}
