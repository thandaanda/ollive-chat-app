"use client";

import { useRouter } from "next/navigation";
import {
  Activity,
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Square,
  Trash2,
  User,
  X
} from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  uiMessageText,
  type ChatMessageMetadata,
  type ChatMetaPayload,
  type OlliveUIMessage
} from "@/lib/chat-ui-messages";

type ProviderOption = {
  id: string;
  label: string;
  configuredByServer: boolean;
  models: string[];
};

type EffectiveProviderOption = ProviderOption & {
  configuredInBrowser: boolean;
  usable: boolean;
};

type ProviderSettings = Record<
  string,
  {
    apiKey?: string;
    models?: string[];
    selectedModel?: string;
  }
>;

type ConversationSummary = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  lastMessage: null | {
    role: string;
    content: string;
    status: string;
  };
};

type StoredChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  provider?: string | null;
  model?: string | null;
  status: string;
  requestId?: string | null;
  createdAt?: string;
};

type Metrics = {
  summary: {
    totalRequests: number;
    completed: number;
    failed: number;
    cancelled: number;
    errorRate: number;
    averageLatencyMs: number;
    totalTokens: number;
  };
  throughputByHour: Array<{ label: string; value: number }>;
  providerBreakdown: Array<{ label: string; value: number }>;
  modelBreakdown: Array<{ label: string; value: number }>;
  statusBreakdown: Array<{ label: string; value: number }>;
};

const PROVIDER_SETTINGS_KEY = "ollive-provider-settings-v1";

const emptyMetrics: Metrics = {
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
};

let cachedMetrics: Metrics | null = null;
let metricsRequest: Promise<Metrics> | null = null;

export function ChatApp({ initialConversationId = null }: { initialConversationId?: string | null }) {
  const router = useRouter();
  const routedConversationId = initialConversationId?.trim() || null;
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>({});
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  const [manualModelDrafts, setManualModelDrafts] = useState<Record<string, string>>({});
  const [providerErrors, setProviderErrors] = useState<Record<string, string | undefined>>({});
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelLoadingProvider, setModelLoadingProvider] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [input, setInput] = useState("");
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestChatMeta, setLatestChatMeta] = useState<ChatMetaPayload | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const selectedProviderRef = useRef("");
  const selectedModelRef = useRef("");
  const providerSettingsRef = useRef<ProviderSettings>({});
  const refreshAfterChatRef = useRef<() => Promise<void>>(async () => {});
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport<OlliveUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => {
          const provider = selectedProviderRef.current;
          const model = selectedModelRef.current;
          const apiKey = providerSettingsRef.current[provider]?.apiKey?.trim() || undefined;
          const latestUserMessage = findLastUserMessage(messages);

          return {
            body: {
              id: activeConversationIdRef.current,
              message: latestUserMessage ?? messages[messages.length - 1],
              provider,
              model,
              apiKey
            }
          };
        }
      }),
    []
  );

  const {
    messages,
    setMessages,
    sendMessage,
    stop,
    status: chatStatus,
    error: chatError,
    clearError
  } = useChat<OlliveUIMessage>({
    transport: chatTransport,
    experimental_throttle: 40,
    onData: (dataPart) => {
      if (dataPart.type === "data-chat-meta") {
        setLatestChatMeta(dataPart.data);
      }
    },
    onError: (chatError) => {
      setError(chatError.message || "Chat request failed");
    },
    onFinish: () => {
      void refreshAfterChatRef.current();
    }
  });

  const effectiveProviders = useMemo<EffectiveProviderOption[]>(() => {
    return providers.map((provider) => {
      const settings = providerSettings[provider.id];
      const browserModels = settings?.models?.filter(Boolean) ?? [];
      return {
        ...provider,
        models: browserModels.length > 0 ? browserModels : provider.models,
        configuredInBrowser: Boolean(settings?.apiKey),
        usable: Boolean(settings?.apiKey || provider.configuredByServer)
      };
    });
  }, [providerSettings, providers]);

  const usableProviders = useMemo(
    () => effectiveProviders.filter((provider) => provider.usable),
    [effectiveProviders]
  );

  const activeProvider = useMemo(
    () => usableProviders.find((provider) => provider.id === selectedProvider),
    [selectedProvider, usableProviders]
  );

  const loadProviders = useCallback(async () => {
    const data = await fetchJson<{ providers: ProviderOption[] }>("/api/providers");
    setProviders(data.providers);
  }, []);

  const loadConversations = useCallback(async () => {
    const data = await fetchJson<{ conversations: ConversationSummary[] }>("/api/conversations");
    setConversations(data.conversations);
  }, []);

  const loadMetrics = useCallback(async (options: { force?: boolean } = {}) => {
    const data = await fetchDashboardMetrics(options);
    setMetrics(data);
  }, []);

  const refreshAll = useCallback(async (options: { forceMetrics?: boolean } = {}) => {
    const results = await Promise.allSettled([
      loadProviders(),
      loadConversations(),
      loadMetrics({ force: options.forceMetrics })
    ]);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected && rejected.status === "rejected") {
      setError(rejected.reason instanceof Error ? rejected.reason.message : "Unable to refresh data");
    }
  }, [loadConversations, loadMetrics, loadProviders]);

  useEffect(() => {
    const storedSettings = readProviderSettings();
    setProviderSettings(storedSettings);
    setApiKeyDrafts(
      Object.fromEntries(Object.entries(storedSettings).map(([providerId, settings]) => [providerId, settings.apiKey ?? ""]))
    );
    void refreshAll({ forceMetrics: false });
  }, [refreshAll]);

  useEffect(() => {
    if (usableProviders.some((provider) => provider.id === selectedProvider)) {
      return;
    }

    const firstProvider = usableProviders[0];
    setSelectedProvider(firstProvider?.id ?? "");
    if (firstProvider) {
      const storedModel = providerSettings[firstProvider.id]?.selectedModel;
      setSelectedModel(storedModel && firstProvider.models.includes(storedModel) ? storedModel : firstProvider.models[0] || "");
    } else {
      setSelectedModel("");
    }
  }, [providerSettings, selectedProvider, usableProviders]);

  useEffect(() => {
    if (!activeProvider) {
      return;
    }

    if (activeProvider.models.length === 0) {
      if (selectedModel) {
        setSelectedModel("");
      }
      return;
    }

    const storedModel = providerSettings[activeProvider.id]?.selectedModel;
    if (storedModel && activeProvider.models.includes(storedModel)) {
      setSelectedModel(storedModel);
      return;
    }

    if (!activeProvider.models.includes(selectedModel)) {
      setSelectedModel(activeProvider.models[0]);
    }
  }, [activeProvider, providerSettings, selectedModel]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    selectedProviderRef.current = selectedProvider;
  }, [selectedProvider]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    providerSettingsRef.current = providerSettings;
  }, [providerSettings]);

  useEffect(() => {
    if (chatError) {
      setError(chatError.message || "Chat request failed");
    }
  }, [chatError]);

  useEffect(() => {
    if (!latestChatMeta) {
      return;
    }

    setActiveConversationId(latestChatMeta.conversationId);
    activeConversationIdRef.current = latestChatMeta.conversationId;
    const conversationPath = `/conversations/${latestChatMeta.conversationId}`;
    if (window.location.pathname !== conversationPath) {
      router.replace(conversationPath);
    }
    setMessages((current) => {
      const userIndex = findLastMessageIndex(current, "user");
      return current.map((message, index) => {
        if (index === userIndex) {
          return {
            ...message,
            id: latestChatMeta.userMessageId
          };
        }

        if (message.id === latestChatMeta.assistantMessageId) {
          return withMessageMetadata(message, {
            requestId: latestChatMeta.requestId,
            status: "streaming"
          });
        }

        return message;
      });
    });
  }, [latestChatMeta, router, setMessages]);

  function updateProviderSettings(
    providerId: string,
    updater: (current: ProviderSettings[string]) => ProviderSettings[string]
  ) {
    setProviderSettings((current) => {
      const nextSettings = { ...current };
      const nextProviderSettings = cleanProviderSettings(updater(current[providerId] ?? {}));

      if (nextProviderSettings) {
        nextSettings[providerId] = nextProviderSettings;
      } else {
        delete nextSettings[providerId];
      }

      writeProviderSettings(nextSettings);
      return nextSettings;
    });
  }

  function chooseProvider(providerId: string) {
    const provider = usableProviders.find((candidate) => candidate.id === providerId);
    if (!provider) {
      return;
    }

    const storedModel = providerSettings[provider.id]?.selectedModel;
    setSelectedProvider(provider.id);
    setSelectedModel(storedModel && provider.models.includes(storedModel) ? storedModel : provider.models[0] || "");
  }

  function chooseModel(providerId: string, model: string) {
    setSelectedModel(model);
    updateProviderSettings(providerId, (current) => ({
      ...current,
      selectedModel: model
    }));
  }

  function saveApiKey(providerId: string) {
    const apiKey = apiKeyDrafts[providerId]?.trim() ?? "";
    if (!apiKey) {
      setProviderErrors((current) => ({ ...current, [providerId]: "Add an API key before saving." }));
      return;
    }

    updateProviderSettings(providerId, (current) => ({
      ...current,
      apiKey
    }));
    setProviderErrors((current) => ({ ...current, [providerId]: undefined }));
  }

  function deleteApiKey(providerId: string) {
    setApiKeyDrafts((current) => ({ ...current, [providerId]: "" }));
    updateProviderSettings(providerId, (current) => ({
      ...current,
      apiKey: undefined
    }));
    setProviderErrors((current) => ({ ...current, [providerId]: undefined }));
  }

  async function fetchModels(providerId: string) {
    const apiKey = apiKeyDrafts[providerId]?.trim() || providerSettings[providerId]?.apiKey?.trim() || "";
    if (!apiKey) {
      setProviderErrors((current) => ({ ...current, [providerId]: "Add an API key before fetching models." }));
      return;
    }

    setModelLoadingProvider(providerId);
    setProviderErrors((current) => ({ ...current, [providerId]: undefined }));

    try {
      const response = await fetch("/api/providers/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          provider: providerId,
          apiKey
        })
      });

      const payload = (await response.json()) as { models?: string[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Model lookup failed with HTTP ${response.status}`);
      }

      const models = payload.models ?? [];
      const nextModel = models[0] || providerSettings[providerId]?.selectedModel || "";
      updateProviderSettings(providerId, (current) => ({
        ...current,
        apiKey,
        models,
        selectedModel: nextModel || current.selectedModel
      }));

      if (providerId === selectedProvider && nextModel) {
        setSelectedModel(nextModel);
      }
    } catch (fetchError) {
      setProviderErrors((current) => ({
        ...current,
        [providerId]: fetchError instanceof Error ? fetchError.message : "Model lookup failed"
      }));
    } finally {
      setModelLoadingProvider(null);
    }
  }

  function addManualModel(providerId: string) {
    const model = manualModelDrafts[providerId]?.trim() ?? "";
    if (!model) {
      return;
    }

    updateProviderSettings(providerId, (current) => {
      const models = [...new Set([...(current.models ?? []), model])];
      return {
        ...current,
        models,
        selectedModel: model
      };
    });

    if (providerId === selectedProvider) {
      setSelectedModel(model);
    }

    setManualModelDrafts((current) => ({ ...current, [providerId]: "" }));
  }

  const loadConversation = useCallback(async (id: string) => {
    setLoadingConversation(true);
    setError(null);

    try {
      const data = await fetchJson<{ conversation: { id: string; messages: StoredChatMessage[] } }>(
        `/api/conversations/${id}`
      );
      setActiveConversationId(data.conversation.id);
      activeConversationIdRef.current = data.conversation.id;
      setMessages(data.conversation.messages.map(storedMessageToUiMessage));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load conversation");
    } finally {
      setLoadingConversation(false);
    }
  }, [setMessages]);

  useEffect(() => {
    if (!routedConversationId || activeConversationIdRef.current === routedConversationId) {
      return;
    }

    void loadConversation(routedConversationId);
  }, [loadConversation, routedConversationId]);

  function openConversation(id: string) {
    router.push(`/conversations/${id}`);
    if (id !== activeConversationIdRef.current) {
      void loadConversation(id);
    }
  }

  function startNewConversation() {
    router.push("/");
    setActiveConversationId(null);
    activeConversationIdRef.current = null;
    setMessages([]);
    setError(null);
    clearError();
  }

  function cancelStream() {
    stop();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();

    if (!message || !activeProvider?.usable || !selectedModel || chatStatus === "streaming" || chatStatus === "submitted") {
      return;
    }

    setInput("");
    setError(null);
    clearError();
    await sendMessage({
      text: message,
      metadata: {
        provider: selectedProvider,
        model: selectedModel,
        status: "complete"
      }
    });
  }

  const streaming = chatStatus === "streaming" || chatStatus === "submitted";
  const sendDisabled =
    streaming || loadingConversation || !activeProvider?.usable || !selectedProvider || !selectedModel || !input.trim();
  const hasMessages = messages.length > 0;

  useEffect(() => {
    refreshAfterChatRef.current = async () => {
      await Promise.all([loadConversations(), loadMetrics({ force: true })]);
      const conversationId = activeConversationIdRef.current;
      if (conversationId) {
        await loadConversation(conversationId);
      }
    };
  }, [loadConversation, loadConversations, loadMetrics]);

  return (
    <main className="h-dvh overflow-hidden px-4 py-4 text-ink md:px-6">
      <div className="mx-auto grid h-full min-h-0 max-w-[1560px] grid-rows-[180px_minmax(0,1fr)_220px] gap-4 lg:grid-rows-none lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-black/10 bg-white/78 p-3 shadow-panel">
          <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-semibold">Inference Console</h1>
              <p className="text-xs text-ink/58">{conversations.length} conversations</p>
            </div>
            <button
              type="button"
              onClick={startNewConversation}
              className="grid h-9 w-9 place-items-center rounded-md border border-black/10 bg-field text-pine transition hover:border-pine/35"
              title="New conversation"
            >
              <Plus size={18} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-lg border border-black/10 bg-field/70 px-3 py-2 text-left text-sm font-semibold transition hover:border-pine/35"
            title="Provider settings"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Settings size={16} className="shrink-0 text-pine" />
              <span className="truncate">Provider Settings</span>
            </span>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-ink/55">
              {usableProviders.length}/{effectiveProviders.length}
            </span>
          </button>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => openConversation(conversation.id)}
                className={clsx(
                  "w-full rounded-lg border p-3 text-left transition",
                  conversation.id === activeConversationId
                    ? "border-pine bg-pine text-white"
                    : "border-black/10 bg-field/70 hover:border-pine/35"
                )}
              >
                <div className="flex items-start gap-2">
                  <MessageSquare size={16} className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{conversation.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs opacity-70">
                      {conversation.lastMessage?.content || conversation.status}
                    </p>
                  </div>
                </div>
              </button>
            ))}

            {conversations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-black/15 p-4 text-sm text-ink/60">
                No conversations yet.
              </div>
            ) : null}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-panel">
          {hasMessages || loadingConversation ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
              {loadingConversation ? (
                <div className="flex items-center gap-2 text-sm text-ink/60">
                  <Loader2 size={16} className="animate-spin" />
                  Loading conversation
                </div>
              ) : null}

              <div className="space-y-4">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                <div ref={scrollAnchorRef} aria-hidden="true" />
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-8">
              <div className="w-full max-w-3xl">
                <ChatComposer
                  variant="centered"
                  input={input}
                  onInputChange={setInput}
                  onSubmit={handleSubmit}
                  streaming={streaming}
                  sendDisabled={sendDisabled}
                  loadingConversation={loadingConversation}
                  onCancel={cancelStream}
                  providers={usableProviders}
                  selectedProvider={selectedProvider}
                  selectedModel={selectedModel}
                  activeProvider={activeProvider}
                  onSelectProvider={chooseProvider}
                  onSelectModel={chooseModel}
                />
              </div>
            </div>
          )}

          {error ? (
            <div className="max-h-24 shrink-0 overflow-y-auto border-t border-coral/20 bg-coral/10 px-4 py-2 text-sm text-coral">
              {error}
            </div>
          ) : null}

          {hasMessages || loadingConversation ? (
            <ChatComposer
              variant="docked"
              input={input}
              onInputChange={setInput}
              onSubmit={handleSubmit}
              streaming={streaming}
              sendDisabled={sendDisabled}
              loadingConversation={loadingConversation}
              onCancel={cancelStream}
              providers={usableProviders}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              activeProvider={activeProvider}
              onSelectProvider={chooseProvider}
              onSelectModel={chooseModel}
            />
          ) : null}
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-black/10 bg-white/78 p-4 shadow-panel">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky">Telemetry</p>
              <h2 className="text-lg font-semibold">Live Metrics</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void refreshAll({ forceMetrics: true })}
                className="grid h-9 w-9 place-items-center rounded-md border border-black/10 bg-field text-sky transition hover:border-sky/35"
                title="Refresh"
              >
                <RefreshCw size={16} />
              </button>
              <Activity size={20} className="text-sky" />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Requests" value={metrics.summary.totalRequests.toLocaleString()} />
              <Metric label="Errors" value={`${Math.round(metrics.summary.errorRate * 100)}%`} />
              <Metric label="Latency" value={`${metrics.summary.averageLatencyMs} ms`} />
              <Metric label="Tokens" value={metrics.summary.totalTokens.toLocaleString()} />
            </div>

            <Breakdown title="Status" items={metrics.statusBreakdown} />
            <Breakdown title="Providers" items={metrics.providerBreakdown} />
            <Breakdown title="Models" items={metrics.modelBreakdown} />
            <Breakdown title="Throughput" items={metrics.throughputByHour.slice(-8)} compactLabels />
          </div>
        </aside>
      </div>

      {settingsOpen ? (
        <SettingsModal
          providers={effectiveProviders}
          providerSettings={providerSettings}
          apiKeyDrafts={apiKeyDrafts}
          manualModelDrafts={manualModelDrafts}
          providerErrors={providerErrors}
          revealedKeys={revealedKeys}
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          modelLoadingProvider={modelLoadingProvider}
          onClose={() => setSettingsOpen(false)}
          onDraftKeyChange={(providerId, value) =>
            setApiKeyDrafts((current) => ({ ...current, [providerId]: value }))
          }
          onDraftManualModelChange={(providerId, value) =>
            setManualModelDrafts((current) => ({ ...current, [providerId]: value }))
          }
          onRevealToggle={(providerId) =>
            setRevealedKeys((current) => ({ ...current, [providerId]: !current[providerId] }))
          }
          onSaveKey={saveApiKey}
          onDeleteKey={deleteApiKey}
          onFetchModels={(providerId) => void fetchModels(providerId)}
          onAddManualModel={addManualModel}
          onSelectProvider={chooseProvider}
          onSelectModel={chooseModel}
        />
      ) : null}
    </main>
  );
}

function SettingsModal({
  providers,
  providerSettings,
  apiKeyDrafts,
  manualModelDrafts,
  providerErrors,
  revealedKeys,
  selectedProvider,
  selectedModel,
  modelLoadingProvider,
  onClose,
  onDraftKeyChange,
  onDraftManualModelChange,
  onRevealToggle,
  onSaveKey,
  onDeleteKey,
  onFetchModels,
  onAddManualModel,
  onSelectProvider,
  onSelectModel
}: {
  providers: EffectiveProviderOption[];
  providerSettings: ProviderSettings;
  apiKeyDrafts: Record<string, string>;
  manualModelDrafts: Record<string, string>;
  providerErrors: Record<string, string | undefined>;
  revealedKeys: Record<string, boolean>;
  selectedProvider: string;
  selectedModel: string;
  modelLoadingProvider: string | null;
  onClose: () => void;
  onDraftKeyChange: (providerId: string, value: string) => void;
  onDraftManualModelChange: (providerId: string, value: string) => void;
  onRevealToggle: (providerId: string) => void;
  onSaveKey: (providerId: string) => void;
  onDeleteKey: (providerId: string) => void;
  onFetchModels: (providerId: string) => void;
  onAddManualModel: (providerId: string) => void;
  onSelectProvider: (providerId: string) => void;
  onSelectModel: (providerId: string, model: string) => void;
}) {
  const [activeSettingsProviderId, setActiveSettingsProviderId] = useState("");
  const activeProvider = providers.find((provider) => provider.id === activeSettingsProviderId) ?? providers[0];

  useEffect(() => {
    if (providers.some((provider) => provider.id === activeSettingsProviderId)) {
      return;
    }

    setActiveSettingsProviderId(providers[0]?.id ?? "");
  }, [activeSettingsProviderId, providers]);

  const settings = activeProvider ? providerSettings[activeProvider.id] : undefined;
  const draftKey = activeProvider ? apiKeyDrafts[activeProvider.id] ?? settings?.apiKey ?? "" : "";
  const isLoading = activeProvider ? modelLoadingProvider === activeProvider.id : false;
  const configuredLabel = activeProvider?.configuredInBrowser
    ? "Browser key"
    : activeProvider?.configuredByServer
      ? "Server fallback"
      : "Not configured";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-panel"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-black/10 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-coral">Settings</p>
            <h2 id="provider-settings-title" className="text-xl font-semibold">
              Provider Keys & Models
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-md border border-black/10 bg-field text-pine transition hover:border-pine/35"
            title="Close settings"
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div
            role="tablist"
            aria-label="Provider settings tabs"
            className="mb-4 grid grid-cols-3 rounded-md border border-black/10 bg-field p-1"
          >
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                role="tab"
                aria-selected={activeProvider?.id === provider.id}
                onClick={() => setActiveSettingsProviderId(provider.id)}
                className={clsx(
                  "flex min-w-0 items-center justify-center gap-1 rounded px-3 py-2 text-sm font-semibold transition",
                  activeProvider?.id === provider.id
                    ? "bg-pine text-white"
                    : "text-ink/60 hover:bg-field hover:text-ink"
                )}
              >
                <span
                  className={clsx(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    provider.usable ? "bg-current" : "border border-current"
                  )}
                  aria-hidden="true"
                />
                <span className="truncate">{provider.label}</span>
              </button>
            ))}
          </div>

          {activeProvider ? (
            <section
              className={clsx(
                "rounded-lg border bg-field/45 p-4",
                selectedProvider === activeProvider.id ? "border-pine" : "border-black/10"
              )}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{activeProvider.label}</h3>
                  <p className="mt-1 flex items-center gap-1 text-xs text-ink/60">
                    {activeProvider.usable ? <CheckCircle2 size={13} className="text-pine" /> : <KeyRound size={13} />}
                    {configuredLabel}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectProvider(activeProvider.id)}
                  disabled={!activeProvider.usable}
                  className="rounded-md border border-black/10 bg-white px-3 py-2 text-xs font-medium text-pine transition hover:border-pine/35 disabled:cursor-not-allowed disabled:text-ink/35"
                >
                  Use
                </button>
              </div>

              <label className="mb-1 block text-xs font-medium text-ink/70" htmlFor={`${activeProvider.id}-api-key`}>
                API key
              </label>
              <div className="flex gap-1">
                <input
                  id={`${activeProvider.id}-api-key`}
                  type={revealedKeys[activeProvider.id] ? "text" : "password"}
                  value={draftKey}
                  onChange={(event) => onDraftKeyChange(activeProvider.id, event.target.value)}
                  placeholder="Paste provider key"
                  className="h-10 min-w-0 flex-1 rounded-md border border-black/10 bg-white px-3 text-sm outline-none focus:border-pine"
                />
                <button
                  type="button"
                  onClick={() => onRevealToggle(activeProvider.id)}
                  className="grid h-10 w-10 place-items-center rounded-md border border-black/10 bg-white text-pine"
                  title={revealedKeys[activeProvider.id] ? "Hide key" : "Reveal key"}
                >
                  {revealedKeys[activeProvider.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>

              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-1">
                <button
                  type="button"
                  onClick={() => onSaveKey(activeProvider.id)}
                  className="rounded-md bg-pine px-2 py-2 text-xs font-semibold text-white transition hover:bg-pine/90"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => onFetchModels(activeProvider.id)}
                  disabled={isLoading}
                  className="rounded-md border border-black/10 bg-white px-2 py-2 text-xs font-semibold text-pine transition hover:border-pine/35 disabled:cursor-not-allowed disabled:text-ink/35"
                >
                  {isLoading ? "Fetching" : "Models"}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteKey(activeProvider.id)}
                  className="grid h-9 w-9 place-items-center rounded-md border border-black/10 bg-white text-coral"
                  title="Delete browser key"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {providerErrors[activeProvider.id] ? (
                <p className="mt-2 rounded-md bg-coral/10 px-2 py-1 text-xs text-coral">
                  {providerErrors[activeProvider.id]}
                </p>
              ) : null}

              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-ink/70" htmlFor={`${activeProvider.id}-manual-model`}>
                  Manual model
                </label>
                <div className="flex gap-1">
                  <input
                    id={`${activeProvider.id}-manual-model`}
                    value={manualModelDrafts[activeProvider.id] ?? ""}
                    onChange={(event) => onDraftManualModelChange(activeProvider.id, event.target.value)}
                    placeholder="model-id"
                    className="h-10 min-w-0 flex-1 rounded-md border border-black/10 bg-white px-3 text-sm outline-none focus:border-pine"
                  />
                  <button
                    type="button"
                    onClick={() => onAddManualModel(activeProvider.id)}
                    className="grid h-10 w-10 place-items-center rounded-md border border-black/10 bg-white text-pine"
                    title="Add manual model"
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </div>

              <div className="mt-4 max-h-44 space-y-1 overflow-y-auto pr-1">
                {activeProvider.models.length === 0 ? (
                  <p className="rounded-md border border-dashed border-black/15 p-2 text-xs text-ink/55">
                    No models saved yet.
                  </p>
                ) : null}
                {activeProvider.models.map((model) => (
                  <button
                    key={model}
                    type="button"
                    disabled={!activeProvider.usable}
                    onClick={() => {
                      onSelectProvider(activeProvider.id);
                      onSelectModel(activeProvider.id, model);
                    }}
                    className={clsx(
                      "w-full rounded-md border px-2 py-1 text-left text-xs transition disabled:cursor-not-allowed disabled:text-ink/35",
                      selectedProvider === activeProvider.id && selectedModel === model
                        ? "border-pine bg-pine text-white disabled:text-white"
                        : "border-black/10 bg-white hover:border-pine/35"
                    )}
                  >
                    {model}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <p className="rounded-md border border-dashed border-black/15 bg-white p-3 text-xs text-ink/55">
              Provider catalog is loading.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function ChatComposer({
  variant,
  input,
  onInputChange,
  onSubmit,
  streaming,
  sendDisabled,
  loadingConversation,
  onCancel,
  providers,
  selectedProvider,
  selectedModel,
  activeProvider,
  onSelectProvider,
  onSelectModel
}: {
  variant: "centered" | "docked";
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  streaming: boolean;
  sendDisabled: boolean;
  loadingConversation: boolean;
  onCancel: () => void;
  providers: EffectiveProviderOption[];
  selectedProvider: string;
  selectedModel: string;
  activeProvider?: EffectiveProviderOption;
  onSelectProvider: (providerId: string) => void;
  onSelectModel: (providerId: string, model: string) => void;
}) {
  const hasProviders = providers.length > 0;
  const hasModels = Boolean(activeProvider?.models.length);
  const statusMessage = !hasProviders
    ? "Add a provider key in the left sidebar to start chatting."
    : !hasModels
      ? "Fetch or add a model in Provider Settings before sending a message."
      : null;

  return (
    <form onSubmit={onSubmit} className={clsx(variant === "docked" && "shrink-0 border-t border-black/10 p-4")}>
      <div className="rounded-lg border border-black/10 bg-field p-2 shadow-sm">
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          rows={variant === "centered" ? 4 : 2}
          placeholder="Ask anything..."
          className="max-h-44 min-h-20 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-ink/38"
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-2">
          <label className="sr-only" htmlFor={`${variant}-provider`}>
            Provider
          </label>
          <select
            id={`${variant}-provider`}
            aria-label="Provider"
            value={selectedProvider}
            onChange={(event) => onSelectProvider(event.target.value)}
            disabled={!hasProviders || streaming || loadingConversation}
            className="h-9 max-w-full rounded-md border border-black/10 bg-white px-2 text-xs font-medium outline-none focus:border-pine disabled:cursor-not-allowed disabled:text-ink/40 sm:max-w-40"
          >
            {hasProviders ? (
              providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))
            ) : (
              <option value="">No providers configured</option>
            )}
          </select>

          <label className="sr-only" htmlFor={`${variant}-model`}>
            Model
          </label>
          <select
            id={`${variant}-model`}
            aria-label="Model"
            value={selectedModel}
            onChange={(event) => onSelectModel(selectedProvider, event.target.value)}
            disabled={!hasModels || streaming || loadingConversation}
            className="h-9 min-w-0 max-w-full rounded-md border border-black/10 bg-white px-2 text-xs font-medium outline-none focus:border-pine disabled:cursor-not-allowed disabled:text-ink/40 sm:max-w-72"
          >
            {activeProvider?.models.length ? (
              activeProvider.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))
            ) : (
              <option value="">Add model in settings</option>
            )}
          </select>

          {statusMessage ? <p className="min-w-0 flex-1 text-xs text-ink/55">{statusMessage}</p> : <div className="flex-1" />}

          {streaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-coral text-white transition hover:bg-coral/90"
              title="Cancel response"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={sendDisabled}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-pine text-white transition hover:bg-pine/90 disabled:cursor-not-allowed disabled:bg-ink/25"
              title="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function MessageBubble({ message }: { message: OlliveUIMessage }) {
  const isUser = message.role === "user";
  const content = uiMessageText(message);
  const status = message.metadata?.status ?? "complete";
  const provider = message.metadata?.provider;
  const model = message.metadata?.model;

  return (
    <div className={clsx("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? (
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-pine text-white">
          <Bot size={16} />
        </div>
      ) : null}

      <div
        className={clsx(
          "max-w-[78%] rounded-lg border px-4 py-3 text-sm leading-6",
          isUser ? "border-pine/10 bg-pine text-white" : "border-black/10 bg-field text-ink"
        )}
      >
        <p className="whitespace-pre-wrap break-words">
          {content || (status === "streaming" ? "Thinking" : "")}
          {status === "streaming" ? <span className="streaming-cursor" aria-hidden="true" /> : null}
        </p>
        <div className={clsx("mt-2 text-[11px]", isUser ? "text-white/65" : "text-ink/45")}>
          {status}
          {provider && model ? ` · ${provider}/${model}` : ""}
        </div>
      </div>

      {isUser ? (
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-coral text-white">
          <User size={16} />
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 bg-field p-3">
      <p className="text-xs text-ink/55">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Breakdown({
  title,
  items,
  compactLabels = false
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  compactLabels?: boolean;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="mt-5">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-ink/55">No data yet.</p> : null}
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs text-ink/62">
              <span className="truncate">{compactLabels ? formatCompactLabel(item.label) : item.label}</span>
              <span>{item.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/8">
              <div
                className="h-full rounded-full bg-sky"
                style={{ width: `${Math.max(8, (item.value / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function storedMessageToUiMessage(message: StoredChatMessage): OlliveUIMessage {
  return {
    id: message.id,
    role: message.role,
    metadata: {
      provider: message.provider ?? undefined,
      model: message.model ?? undefined,
      status: message.status,
      requestId: message.requestId ?? undefined,
      createdAt: message.createdAt
    },
    parts: [
      {
        type: "text",
        text: message.content
      }
    ]
  };
}

function findLastUserMessage(messages: OlliveUIMessage[]): OlliveUIMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index];
    }
  }

  return undefined;
}

function findLastMessageIndex(messages: OlliveUIMessage[], role: OlliveUIMessage["role"]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) {
      return index;
    }
  }

  return -1;
}

function withMessageMetadata(message: OlliveUIMessage, metadata: ChatMessageMetadata): OlliveUIMessage {
  return {
    ...message,
    metadata: {
      ...message.metadata,
      ...metadata
    }
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchDashboardMetrics({ force = false }: { force?: boolean } = {}): Promise<Metrics> {
  if (!force && cachedMetrics) {
    return cachedMetrics;
  }

  if (!force && metricsRequest) {
    return metricsRequest;
  }

  metricsRequest = fetchJson<Metrics>("/api/dashboard/metrics")
    .then((data) => {
      cachedMetrics = data;
      return data;
    })
    .finally(() => {
      metricsRequest = null;
    });

  return metricsRequest;
}

export function resetChatAppMetricsCacheForTests() {
  cachedMetrics = null;
  metricsRequest = null;
}

function readProviderSettings(): ProviderSettings {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PROVIDER_SETTINGS_KEY);
    if (!raw) {
      return {};
    }

    return sanitizeStoredProviderSettings(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

function writeProviderSettings(settings: ProviderSettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PROVIDER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage can be unavailable in private or locked-down browser contexts.
  }
}

function sanitizeStoredProviderSettings(value: unknown): ProviderSettings {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([providerId, rawSettings]) => {
      if (!isRecord(rawSettings)) {
        return [];
      }

      const settings = cleanProviderSettings({
        apiKey: typeof rawSettings.apiKey === "string" ? rawSettings.apiKey : undefined,
        models: Array.isArray(rawSettings.models)
          ? rawSettings.models.filter((model): model is string => typeof model === "string" && Boolean(model.trim()))
          : undefined,
        selectedModel: typeof rawSettings.selectedModel === "string" ? rawSettings.selectedModel : undefined
      });

      return settings ? [[providerId, settings]] : [];
    })
  );
}

function cleanProviderSettings(settings: ProviderSettings[string]): ProviderSettings[string] | null {
  const apiKey = settings.apiKey?.trim() || undefined;
  const models = [...new Set(settings.models?.map((model) => model.trim()).filter(Boolean) ?? [])];
  const selectedModel = settings.selectedModel?.trim() || undefined;

  if (!apiKey && models.length === 0 && !selectedModel) {
    return null;
  }

  return {
    apiKey,
    models,
    selectedModel
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatCompactLabel(label: string): string {
  const date = new Date(label);
  if (Number.isNaN(date.getTime())) {
    return label;
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
