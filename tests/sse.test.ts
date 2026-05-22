import { describe, expect, it } from "vitest";
import { encodeSse, parseSse } from "@/lib/sse";

describe("sse helpers", () => {
  it("encodes and parses events", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(encodeSse("token", { delta: "hello" })));
        controller.close();
      }
    });

    const response = new Response(body);
    const events = [];
    for await (const event of parseSse(response)) {
      events.push(event);
    }

    expect(events).toEqual([{ event: "token", data: '{"delta":"hello"}' }]);
  });
});
