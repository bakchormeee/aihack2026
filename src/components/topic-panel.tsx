"use client";

import { SkillMap } from "@/components/charts/skill-map";

type Node = {
  id: string;
  name: string;
  mastery: number | null;
  confidence: number;
  attempts: number;
};

/** The skill map for a course. Selecting a topic opens the same page with `?topic=`, which shows its links. */
export function TopicPanel({
  courseId,
  nodes,
  links,
}: {
  courseId: string;
  nodes: Node[];
  links: { source: string; target: string }[];
}) {
  return (
    <SkillMap
      nodes={nodes}
      links={links}
      // The #topic-actions anchor scrolls the topic's links into view below the map.
      hrefForTopic={(topicId) =>
        `/courses/${courseId}/topics?topic=${encodeURIComponent(topicId)}#topic-actions`
      }
    />
  );
}
