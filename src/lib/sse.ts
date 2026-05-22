export type SseMessage = {
  event?: string;
  data: string;
};

export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function* parseSse(response: Response): AsyncGenerator<SseMessage> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawMessage = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const message = parseSseMessage(rawMessage);
      if (message) {
        yield message;
      }

      boundary = buffer.indexOf("\n\n");
    }
  }

  const trailing = parseSseMessage(buffer.trim());
  if (trailing) {
    yield trailing;
  }
}

function parseSseMessage(raw: string): SseMessage | null {
  if (!raw) {
    return null;
  }

  let event: string | undefined;
  const data: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }

  if (data.length === 0) {
    return null;
  }

  return {
    event,
    data: data.join("\n")
  };
}
