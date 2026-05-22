import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatApp, resetChatAppMetricsCacheForTests } from "@/components/chat-app";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router
}));

describe("ChatApp provider settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetChatAppMetricsCacheForTests();
    router.push.mockReset();
    router.replace.mockReset();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/providers") {
        return Response.json({
          providers: [
            { id: "openai", label: "OpenAI", configuredByServer: false, models: [] },
            { id: "anthropic", label: "Anthropic", configuredByServer: false, models: [] },
            { id: "gemini", label: "Gemini", configuredByServer: false, models: [] }
          ]
        });
      }

      if (url === "/api/conversations") {
        return Response.json({
          conversations: [
            {
              id: "conv_1",
              title: "Saved chat",
              status: "active",
              updatedAt: new Date().toISOString(),
              lastMessage: {
                role: "assistant",
                content: "Saved answer",
                status: "complete"
              }
            }
          ]
        });
      }

      if (url === "/api/conversations/conv_1") {
        return Response.json({
          conversation: {
            id: "conv_1",
            messages: [
              {
                id: "msg_1",
                role: "user",
                content: "Saved question",
                status: "complete",
                provider: "openai",
                model: "gpt-4o-mini",
                requestId: null,
                createdAt: new Date().toISOString()
              },
              {
                id: "msg_2",
                role: "assistant",
                content: "Saved answer",
                status: "complete",
                provider: "openai",
                model: "gpt-4o-mini",
                requestId: "req_1",
                createdAt: new Date().toISOString()
              }
            ]
          }
        });
      }

      if (url === "/api/dashboard/metrics") {
        return Response.json({
          summary: {
            totalRequests: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            errorRate: 0,
            averageLatencyMs: 0,
            totalTokens: 0
          },
          throughputByHour: [],
          providerBreakdown: [],
          modelBreakdown: [],
          statusBreakdown: []
        });
      }

      if (url === "/api/providers/models") {
        const body = JSON.parse(String(init?.body)) as { apiKey: string; provider: string };
        return Response.json({ models: [`${body.provider}-model-from-${body.apiKey}`] });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("saves browser keys, fetches models, and enables send", async () => {
    render(<ChatApp />);

    await screen.findByTitle("Send");
    expect(screen.getByTitle("Send")).toBeDisabled();

    fireEvent.click(screen.getByTitle("Provider settings"));
    const settingsDialog = await screen.findByRole("dialog");
    await within(settingsDialog).findByRole("tab", { name: /OpenAI/ });

    fireEvent.change(document.querySelector<HTMLInputElement>("#openai-api-key")!, {
      target: { value: "sk-browser" }
    });
    fireEvent.click(within(settingsDialog).getByText("Save"));

    expect(JSON.parse(window.localStorage.getItem("ollive-provider-settings-v1") ?? "{}")).toMatchObject({
      openai: { apiKey: "sk-browser" }
    });

    fireEvent.click(within(settingsDialog).getByText("Models"));
    await within(settingsDialog).findAllByText("openai-model-from-sk-browser");

    const providerSelect = screen.getByLabelText("Provider") as HTMLSelectElement;
    expect(Array.from(providerSelect.options).map((option) => option.textContent)).toEqual(["OpenAI"]);

    fireEvent.change(screen.getByPlaceholderText("Ask anything..."), {
      target: { value: "hello" }
    });

    await waitFor(() => expect(screen.getByTitle("Send")).not.toBeDisabled());
  });

  it("loads direct conversation URLs and routes sidebar/new chat actions", async () => {
    render(<ChatApp initialConversationId="conv_1" />);

    await screen.findByText("Saved question");
    expect(screen.getAllByText("Saved answer").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Saved chat"));
    expect(router.push).toHaveBeenCalledWith("/conversations/conv_1");

    fireEvent.click(screen.getByTitle("New conversation"));
    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("does not refetch live metrics when remounting for a conversation route", async () => {
    const firstRender = render(<ChatApp />);

    await screen.findByTitle("Send");
    await waitFor(() =>
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url) === "/api/dashboard/metrics"))
        .toHaveLength(1)
    );

    firstRender.unmount();
    render(<ChatApp initialConversationId="conv_1" />);

    await screen.findByText("Saved question");
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url) === "/api/dashboard/metrics"))
      .toHaveLength(1);
  });
});
