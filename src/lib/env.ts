export const DEFAULT_INGESTION_TOKEN = "dev-ingestion-token";

export function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getIngestionToken(): string {
  return process.env.INGESTION_API_KEY || DEFAULT_INGESTION_TOKEN;
}

export function getAppUrl(requestOrigin?: string): string {
  return process.env.APP_URL || requestOrigin || "http://localhost:3000";
}

export function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
