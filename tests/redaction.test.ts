import { describe, expect, it } from "vitest";
import { previewText, redactPii } from "@/lib/redaction";

describe("redaction", () => {
  it("redacts common PII and token-like values", () => {
    const input =
      "Email me at user@example.com or +1 (415) 555-1212. Card 4242 4242 4242 4242. Bearer abcdefghijklmnopqrstuvwxyz.";

    expect(redactPii(input)).toContain("[redacted-email]");
    expect(redactPii(input)).toContain("[redacted-phone]");
    expect(redactPii(input)).toContain("[redacted-card]");
    expect(redactPii(input)).toContain("Bearer [redacted-token]");
  });

  it("compacts and truncates previews", () => {
    expect(previewText("hello\n\nworld ".repeat(20), 24)).toHaveLength(24);
  });
});
