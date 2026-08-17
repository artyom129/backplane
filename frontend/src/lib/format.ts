import { format, formatDistanceToNowStrict } from "date-fns";

export function formatRelative(value: string | Date): string {
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

export function formatTimestamp(value: string | Date): string {
  return format(new Date(value), "MMM d, HH:mm:ss");
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function shortId(value: string): string {
  return value.slice(0, 8);
}

