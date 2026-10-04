// Ranges and groupings for the metrics page. The API caps a response at 400
// buckets, so hourly grouping is only offered for short ranges.

export const RANGES = {
  "24h": { label: "24 hours", hours: 24 },
  "7d": { label: "7 days", hours: 24 * 7 },
  "30d": { label: "30 days", hours: 24 * 30 },
  "90d": { label: "90 days", hours: 24 * 90 },
} as const;
export type Range = keyof typeof RANGES;

export const GROUPS = ["hour", "day", "week"] as const;
export type Group = (typeof GROUPS)[number];

export const groupAllowed = (range: Range, group: Group) => (group === "hour" ? RANGES[range].hours <= 24 * 14 : group === "week" ? RANGES[range].hours >= 24 * 14 : true);

export const defaultGroup = (range: Range): Group => (range === "24h" ? "hour" : "day");

export const TIMEZONE = "Asia/Kolkata";
