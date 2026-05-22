import { describe, expect, it } from "vitest";
import { isDatabaseUnavailableError } from "@/lib/db-errors";

describe("isDatabaseUnavailableError", () => {
  it("detects Prisma database connectivity failures", () => {
    const error = new Error("Can't reach database server at `localhost:5432`");
    error.name = "PrismaClientInitializationError";

    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it("detects missing DATABASE_URL failures", () => {
    expect(isDatabaseUnavailableError(new Error("Environment variable not found: DATABASE_URL"))).toBe(true);
  });

  it("does not classify generic provider errors as database errors", () => {
    expect(isDatabaseUnavailableError(new Error("OpenAI request failed"))).toBe(false);
  });
});
