// Matches timelineLines in packages/protocol. Unknown payload fields stay out of the summary.
export function timelineLines(event: {
  event_type: string;
  payload: Record<string, unknown>;
}): string[] {
  const lines: string[] = [];
  const summary = event.payload.summary;
  const observation = event.payload.observation;
  if (typeof summary === "string" && summary.length > 0) {
    lines.push(summary);
  }
  if (typeof observation === "string" && observation.length > 0) {
    lines.push(observation);
  }
  if (lines.length === 0) {
    lines.push(event.event_type);
  }
  return lines;
}
