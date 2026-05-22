const REDACTION_RULES: Array<[RegExp, string]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]"],
  [/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-card]"],
  [/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[redacted-phone]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted-token]"],
  [/\b(?:sk|pk|api|key|token|secret)[-_]?[A-Za-z0-9]{16,}\b/gi, "[redacted-secret]"]
];

export function redactPii(input: string): string {
  return REDACTION_RULES.reduce((value, [pattern, replacement]) => {
    return value.replace(pattern, replacement);
  }, input);
}

export function compactWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function previewText(input: string, maxLength = 500): string {
  const redacted = compactWhitespace(redactPii(input));
  if (redacted.length <= maxLength) {
    return redacted;
  }

  return `${redacted.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
