"use client";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import {
  BrainIcon,
  Check,
  Copy,
  Database,
  Eye,
  History,
  Plus,
  RotateCcw,
  Square,
  TableProperties,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import "./chat-panel.css";
import { prepareChatHistory } from "@/lib/chat-history.mjs";
import { RATINGS, SESSION_CHAT_HISTORY, SESSION_CONVERSATIONS, loadModelCatalog } from "@/lib/chat-session.mjs";
import { FEEDBACK_REASONS, fill, plural } from "@/lib/text.mjs";
import { api } from "@/lib/api.mjs";
import { useLatestRequest } from "@/hooks/use-latest-request";

const MAX_SESSION_MESSAGES = 24;
const MODEL_STORAGE_KEY = "dive_app_chat_model";

function readChatHistory(key) {
  const history = SESSION_CHAT_HISTORY.get(key);
  return Array.isArray(history) ? history : [];
}

function writeChatHistory(key, messages) {
  if (!key) return;
  SESSION_CHAT_HISTORY.set(key, messages.slice(-MAX_SESSION_MESSAGES));
}

function readStoredModel() {
  try {
    return window.sessionStorage.getItem(MODEL_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeStoredModel(value) {
  try {
    window.sessionStorage.setItem(MODEL_STORAGE_KEY, value);
  } catch {
    // Remembering the model is a convenience only.
  }
}

const MODEL_NAMES = { auto: "Auto", luna: "Luna", sol: "Sol", astra: "Astra" };

function conversationIdFor(key) {
  if (!SESSION_CONVERSATIONS.has(key)) SESSION_CONVERSATIONS.set(key, globalThis.crypto?.randomUUID?.() ?? `c${Date.now()}${Math.random().toString(36).slice(2)}`);
  return SESSION_CONVERSATIONS.get(key);
}

const COPY = {
  title: "Chat",
  subtitle: "Ask about the data in this Dive.",
  waiting: "Waiting for the Dive to load…",
  unavailable: "The Dive is unavailable. Retry loading it to start chat.",
  connect: "Connect this Dive to start chat.",
  empty: "Ask about the data behind this Dive.",
  starters: ["What does this Dive show?", "Which tables can you query?", "Summarise the key numbers."],
  disabledTitle: "Chat isn't configured for this Dive",
  disabledBody: "Set up a model provider (OPENAI_API_KEY, ANTHROPIC_API_KEY or another provider in docs/model-providers.md), plus the chat token and database variables named for this Dive in dives.config.mjs, in your runtime environment.",
  deniedTitle: "Chat isn't included in your access",
  deniedBody: "Ask an administrator to turn on chat for your account.",
  recording: "Conversations are saved and can be reviewed by administrators.",
  demoRecording: "This is a public demo. Conversations are saved and visible to every visitor.",
  demoRetention: "This is a public demo. Conversations are visible to every visitor and deleted after {days} days.",
  demoUnavailable: "This is not available in a public demo.",
  routed: "Auto · {model}",
  followUps: "Suggested next",
  placeholder: "Ask about this Dive…",
  close: "Close chat",
  clear: "Clear conversation",
  stop: "Stop response",
  retry: "Retry response",
  send: "Send message",
  latest: "Scroll to latest",
  error: "The assistant could not complete that request.",
  rateLimited: "Too many questions in a minute. Wait a moment and try again.",
  thinking: "Thinking…",
  model: "Model",
  steps: {
    getDiveState: "Read the Dive state",
    listTables: "Listed tables",
    describeTable: "Described a table",
    runQuery: "Ran a query",
  },
  pending: {
    getDiveState: "Reading the Dive state…",
    listTables: "Listing tables…",
    describeTable: "Describing a table…",
    runQuery: "Running a query…",
  },
  stateStep: ["1 value", "{n} values"],
  tablesStep: ["1 table", "{n} tables"],
  describedStep: ["Described {table} · 1 column", "Described {table} · {n} columns"],
  rowsStep: ["1 row", "{n} rows"],
  rowsMoreStep: "{n}+ rows",
  sql: "SQL",
  reasoningStep: "Reasoning",
  workedFor: ["Worked for {s}s · 1 step", "Worked for {s}s · {n} steps"],
  explored: ["1 step", "{n} steps"],
  copy: "Copy answer",
  copied: "Copied",
  helpful: "Helpful",
  notHelpful: "Not helpful",
  feedbackSaved: "Thanks. Your rating was saved.",
  feedbackCleared: "Rating removed.",
  feedbackFailed: "The rating could not be saved.",
  reasonTitle: "What went wrong? (optional)",
  reasonNote: "Anything else? (optional)",
  reasonSend: "Send",
  reasonSkip: "Skip",
  reasonSaved: "Thanks. This helps improve the answers.",
  budget: "Your group has used this month's AI chat allowance. It resets on {date}. An administrator can raise it.",
  history: "Past conversations",
  historyBack: "Back to the conversation",
  newConversation: "New conversation",
  historySearch: "Search your questions",
  historyEmpty: "No saved conversations for this Dive yet.",
  historyFailed: "Your conversations could not be loaded. Try again.",
  historyMessages: ["1 message", "{n} messages"],
  deleteConversation: "Delete conversation",
  confirmDelete: "Confirm delete",
  loading: "Loading…",
  modelHint: { auto: "Picks per question", luna: "Fast", sol: "Balanced", astra: "Deep analysis" },
};

function messageText(message) {
  return (message.parts || [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function followUpQuestions(message) {
  const part = (message?.parts || []).findLast((item) => item.type === "data-followups");
  const questions = part?.data?.questions;
  return Array.isArray(questions) ? questions.filter((q) => typeof q === "string" && q.trim()).slice(0, 3) : [];
}

function toolName(part) {
  if (typeof part.toolName === "string") return part.toolName;
  if (typeof part.type === "string" && part.type.startsWith("tool-")) return part.type.slice(5);
  return null;
}

function completedToolOutput(part) {
  if (part.state === "output-available") return part.output;
  if (part.state === "output-error") return { error: part.errorText };
  return null;
}

const STEP_ICONS = {
  getDiveState: Eye,
  listTables: Database,
  describeTable: TableProperties,
  runQuery: Terminal,
};

function stepLabel(name, output) {
  if (name === "describeTable" && output?.table && Array.isArray(output.columns)) {
    return plural(COPY.describedStep, output.columns.length, { table: output.table });
  }
  return COPY.steps[name] || name;
}

function stepDescription(name, output) {
  if (!output || typeof output !== "object") return null;
  if (output.error) return String(output.error);
  if (name === "getDiveState") return plural(COPY.stateStep, Object.keys(output.state || {}).length);
  if (name === "listTables" && Array.isArray(output.tables)) return plural(COPY.tablesStep, output.tables.length);
  if (name === "runQuery" && typeof output.rowCount === "number") {
    return output.truncated ? fill(COPY.rowsMoreStep, { n: output.rowCount.toLocaleString() }) : plural(COPY.rowsStep, output.rowCount);
  }
  return null;
}

// The SQL the agent ran, folded by default so the steps stay scannable.
function QuerySql({ part }) {
  const sql = completedToolOutput(part)?.sql || part.input?.sql;
  if (typeof sql !== "string" || !sql.trim()) return null;
  return (
    <details className="chat-sql">
      <summary>{COPY.sql}</summary>
      <pre><code>{sql.trim()}</code></pre>
    </details>
  );
}

function isThinkingPart(part) {
  if (part.type === "reasoning") return typeof part.text === "string" && part.text.trim().length > 0;
  return Boolean(toolName(part));
}

// Reasoning summaries and data steps in the order the agent produced them. Open
// while the agent works, folded once the answer starts, unless the viewer toggled it.
function ThinkingChain({ message, working, answering }) {
  const steps = (message.parts || []).filter(isThinkingPart);
  const [open, setOpen] = useState(working && !answering);
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) setOpen(working && !answering);
  }, [working, answering]);
  if (!steps.length) return null;

  const current = steps.at(-1);
  const pendingTool = current.type !== "reasoning" && (current.state === "input-streaming" || current.state === "input-available");
  const activeLabel = pendingTool ? COPY.pending[toolName(current)] || COPY.thinking : COPY.thinking;
  const seconds = Math.max(1, Math.round(Number(message.metadata?.workedMs) / 1000));
  const header = working && !answering
    ? <span className="chat-tool-pending">{activeLabel}</span>
    : Number.isFinite(seconds) && message.metadata?.workedMs != null
      ? plural(COPY.workedFor, steps.length, { s: seconds })
      : plural(COPY.explored, steps.length);

  return (
    <ChainOfThought
      className="chat-thinking"
      open={open}
      onOpenChange={(next) => {
        toggled.current = true;
        setOpen(next);
      }}
    >
      <ChainOfThoughtHeader>{header}</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {steps.map((part, index) => {
          const key = `${message.id || "message"}-step-${index}`;
          const last = index === steps.length - 1;
          if (part.type === "reasoning") {
            return (
              <ChainOfThoughtStep key={key} icon={BrainIcon} label={COPY.reasoningStep} status={working && last && !answering ? "active" : "complete"}>
                <MessageResponse className="chat-reasoning-text">{part.text}</MessageResponse>
              </ChainOfThoughtStep>
            );
          }
          const name = toolName(part);
          const pending = part.state === "input-streaming" || part.state === "input-available";
          const output = completedToolOutput(part);
          return (
            <ChainOfThoughtStep
              key={key}
              icon={STEP_ICONS[name]}
              label={pending ? COPY.pending[name] || COPY.thinking : stepLabel(name, output)}
              description={pending ? null : stepDescription(name, output)}
              status={pending ? "active" : "complete"}
              className={output?.error ? "chat-step-error" : undefined}
            >
              {name === "runQuery" && <QuerySql part={part} />}
            </ChainOfThoughtStep>
          );
        })}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

function CopyAnswer({ text }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <MessageAction
      label={copied ? COPY.copied : COPY.copy}
      title={copied ? COPY.copied : COPY.copy}
      onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {})}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </MessageAction>
  );
}

// Ratings survive switching Dives and back, like the conversation itself.

// Thumbs up or down on a saved answer. Pressing the active one again clears it. One rating is
// sent at a time, so a slow or retried request cannot land after a newer choice.
function RateAnswer({ conversationId, answerId, onRated }) {
  const [value, setValue] = useState(() => RATINGS.get(answerId) ?? 0);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const rate = async (pressed) => {
    if (pending) return;
    const next = value === pressed ? 0 : pressed;
    const previous = value;
    setValue(next);
    setPending(true);
    try {
      if (await sendRating(next)) {
        RATINGS.set(answerId, next);
        setStatus(next ? COPY.feedbackSaved : COPY.feedbackCleared);
        onRated?.(next);
        return;
      }
      setValue(previous);
      setStatus(COPY.feedbackFailed);
    } finally {
      setPending(false);
    }
  };
  const sendRating = async (next) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch("/api/chat/feedback", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, answerId, value: next }) });
        if (response.ok) return true;
        // The answer is saved a moment after it finishes, so a quick click may arrive first.
        if (response.status !== 404) return false;
      } catch { return false; }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return false;
  };
  return (
    <>
      <MessageAction label={COPY.helpful} title={COPY.helpful} aria-pressed={value === 1} aria-disabled={pending || undefined} className={value === 1 ? "chat-rated" : undefined} onClick={() => rate(1)}>
        <ThumbsUp aria-hidden="true" />
      </MessageAction>
      <MessageAction label={COPY.notHelpful} title={COPY.notHelpful} aria-pressed={value === -1} aria-disabled={pending || undefined} className={value === -1 ? "chat-rated" : undefined} onClick={() => rate(-1)}>
        <ThumbsDown aria-hidden="true" />
      </MessageAction>
      <span className={status === COPY.feedbackFailed ? "chat-rating-status" : "sr-only"} role="status">{status}</span>
    </>
  );
}

// After a thumbs down, an optional reason and note. Sending updates the same rating.
function FeedbackReason({ conversationId, answerId, onDone }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState("");
  const send = async (event) => {
    event.preventDefault();
    if (!reason && !note.trim()) return onDone();
    setState("saving");
    try {
      const response = await fetch("/api/chat/feedback", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, answerId, value: -1, reason: reason || null, note: note.trim() || null }) });
      setState(response.ok ? "saved" : "failed");
      if (response.ok) setTimeout(onDone, 1600);
    } catch { setState("failed"); }
  };
  if (state === "saved") return <p className="chat-reason-saved" role="status">{COPY.reasonSaved}</p>;
  return (
    <form className="chat-reason" onSubmit={send}>
      <fieldset>
        <legend>{COPY.reasonTitle}</legend>
        <div className="chat-reason-options">
          {Object.entries(FEEDBACK_REASONS).map(([key, label]) => (
            <label key={key} className="chat-reason-option"><input type="radio" name={`reason-${answerId}`} value={key} checked={reason === key} onChange={() => setReason(key)} />{label}</label>
          ))}
        </div>
      </fieldset>
      <label className="chat-reason-note">
        <span>{COPY.reasonNote}</span>
        <textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {state === "failed" && <p className="chat-rating-status" role="status">{COPY.feedbackFailed}</p>}
      <div className="chat-reason-actions">
        <Button type="submit" size="sm" disabled={state === "saving"}>{COPY.reasonSend}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{COPY.reasonSkip}</Button>
      </div>
    </form>
  );
}

// The person's own saved conversations for this Dive. Opening one continues it.
function ConversationHistory({ diveKey, current, demo, onOpen, onNew, onDeleted }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ loading: true, items: [], error: false });
  const [confirming, setConfirming] = useState(null);
  const [opening, setOpening] = useState(null);
  // Typing a new search drops the answer to the previous one; opening another conversation
  // drops the one still loading.
  const search = useLatestRequest();
  const opener = useLatestRequest();
  useEffect(() => {
    const timer = setTimeout(async () => {
      const signal = search.start();
      setState((value) => ({ ...value, loading: true, error: false }));
      try {
        const text = query.trim();
        const params = new URLSearchParams({ dive: diveKey, ...(text ? { q: text } : {}) });
        const { conversations } = await api(`/api/chat/conversations?${params}`, { signal });
        if (!signal.aborted) setState({ loading: false, items: conversations, error: false });
      } catch { if (!signal.aborted) setState({ loading: false, items: [], error: true }); }
    }, 250);
    return () => { clearTimeout(timer); search.abort(); };
  }, [diveKey, query, search]);
  const open = async (id) => {
    const signal = opener.start();
    setOpening(id);
    try {
      const { conversation } = await api(`/api/chat/conversations/${encodeURIComponent(id)}`, { signal });
      if (!signal.aborted) onOpen(conversation);
    } catch { if (!signal.aborted) setState((value) => ({ ...value, error: true })); }
    finally { if (!signal.aborted) setOpening(null); }
  };
  const remove = async (id) => {
    setConfirming(null);
    try {
      await api(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      setState((value) => ({ ...value, items: value.items.filter((item) => item.id !== id) }));
      onDeleted(id);
    } catch { setState((value) => ({ ...value, error: true })); }
  };
  return (
    <section className="chat-history" aria-label={COPY.history}>
      <div className="chat-history-tools">
        <input type="search" className="chat-history-search" aria-label={COPY.historySearch} placeholder={COPY.historySearch} value={query} onChange={(event) => setQuery(event.target.value)} />
        <Button type="button" size="sm" variant="outline" onClick={onNew}><Plus data-icon="inline-start" aria-hidden="true" />{COPY.newConversation}</Button>
      </div>
      {state.error && <p className="chat-request-error" role="alert">{COPY.historyFailed}</p>}
      {!state.loading && !state.error && !state.items.length && <p className="chat-history-empty">{COPY.historyEmpty}</p>}
      <ul className="chat-history-list" aria-busy={state.loading}>
        {state.items.map((item) => (
          <li key={item.id} className={item.id === current ? "chat-history-item is-current" : "chat-history-item"}>
            <button type="button" className="chat-history-open" onClick={() => open(item.id)} aria-current={item.id === current || undefined} disabled={opening === item.id}>
              <span className="chat-history-title">{item.title || "—"}</span>
              <span className="chat-history-meta">{opening === item.id ? COPY.loading : `${new Date(item.updatedAt).toLocaleString()} · ${plural(COPY.historyMessages, item.messageCount)}`}</span>
            </button>
            {/* One button that asks once more in place, so keyboard focus stays on it. */}
            {!demo && (
              <Button
                type="button"
                size={confirming === item.id ? "sm" : "icon-sm"}
                variant={confirming === item.id ? "destructive" : "ghost"}
                onClick={() => (confirming === item.id ? remove(item.id) : setConfirming(item.id))}
                aria-label={`${confirming === item.id ? COPY.confirmDelete : COPY.deleteConversation}: ${item.title}`}
                title={COPY.deleteConversation}
              >
                {confirming === item.id ? COPY.confirmDelete : <Trash2 aria-hidden="true" />}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Saved messages in the shape useChat keeps, so a past conversation continues where it stopped.
function savedMessages(conversation) {
  return conversation.messages.map((message) => {
    if (message.role !== "assistant") return { id: message.id, role: "user", parts: [{ type: "text", text: message.text }] };
    if (message.feedback) RATINGS.set(message.id, message.feedback);
    return { id: message.id, role: "assistant", parts: [{ type: "text", text: message.text }], metadata: { model: message.model || undefined, conversationId: conversation.id, answerId: message.id } };
  });
}

// The tier of the latest answer, so a short follow-up can keep it when routing automatically.
function previousTier(messages) {
  const tier = messages.findLast((message) => message.role === "assistant" && message.metadata?.model)?.metadata.model;
  return ["luna", "sol", "astra"].includes(tier) ? tier : undefined;
}

function ChatMessage({ message, working, showModel, canRate }) {
  const [askReason, setAskReason] = useState(false);
  const text = messageText(message);
  const tier = MODEL_NAMES[message.metadata?.model];
  // Auto answers always say which tier answered and why; manual picks only when several were used.
  const model = message.metadata?.auto && tier ? fill(COPY.routed, { model: tier }) : showModel ? tier : null;
  if (message.role !== "assistant") {
    return (
      <Message from={message.role} className="chat-message">
        <MessageContent data-slot="message-content">{text && <p className="chat-user-text">{text}</p>}</MessageContent>
      </Message>
    );
  }
  return (
    <Message from={message.role} className="chat-message">
      <MessageContent data-slot="message-content">
        <ThinkingChain message={message} working={working} answering={Boolean(text)} />
        {text && <MessageResponse>{text}</MessageResponse>}
        {text && !working && (
          <MessageActions className="chat-message-actions">
            <CopyAnswer text={text} />
            {canRate && message.metadata?.answerId && message.metadata?.conversationId && <RateAnswer conversationId={message.metadata.conversationId} answerId={message.metadata.answerId} onRated={(value) => setAskReason(value === -1)} />}
            {model && <span className="chat-model-tag" title={message.metadata?.routeReason || undefined}>{model}</span>}
          </MessageActions>
        )}
        {askReason && <FeedbackReason conversationId={message.metadata.conversationId} answerId={message.metadata.answerId} onDone={() => setAskReason(false)} />}
      </MessageContent>
    </Message>
  );
}

function ChatHeader({ onClear, onClose, canClear, onHistory, historyOpen }) {
  return (
    <header className="chat-panel-header">
      <div>
        <h2>{COPY.title}</h2>
        <p>{COPY.subtitle}</p>
      </div>
      <div className="chat-panel-header-actions">
        {onHistory && (
          <Button type="button" variant={historyOpen ? "secondary" : "ghost"} size="icon-sm" onClick={onHistory} aria-pressed={historyOpen} aria-label={COPY.history} title={historyOpen ? COPY.historyBack : COPY.history}>
            <History aria-hidden="true" />
          </Button>
        )}
        {onClear && (
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClear} disabled={!canClear} aria-label={COPY.clear} title={COPY.clear}>
            <Trash2 aria-hidden="true" />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label={COPY.close} title={COPY.close}>
          <X aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}

export default function ChatPanel({ dive, state, ready = false, frameStatus = 'loading', onClose }) {
  if (dive && !dive.chatEnabled) {
    return (
      <aside className="chat-panel" aria-label={COPY.title}>
        <ChatHeader onClose={onClose} />
        <div className="chat-disabled" role="status">
          <strong>{dive.chatDenied ? COPY.deniedTitle : COPY.disabledTitle}</strong>
          <span>{dive.chatDenied ? COPY.deniedBody : COPY.disabledBody}</span>
        </div>
      </aside>
    );
  }
  return <ChatSession key={dive?.key || "none"} dive={dive} state={state} ready={ready} frameStatus={frameStatus} onClose={onClose} />;
}

function ChatSession({ dive, state, ready, frameStatus, onClose }) {
  const diveKey = dive?.key || "";
  const [catalog, setCatalog] = useState(null);
  const [model, setModel] = useState(readStoredModel);
  const latestProps = useRef({ diveKey, state, model });
  latestProps.current = { diveKey, state, model };
  const conversationId = useRef(conversationIdFor(diveKey));

  useEffect(() => {
    let active = true;
    loadModelCatalog().then((next) => {
      if (!active || !next) return;
      setCatalog(next);
      setModel((current) => (next.models.includes(current) ? current : next.defaultModel));
    });
    return () => {
      active = false;
    };
  }, []);

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: "/api/chat",
      credentials: "same-origin",
      prepareSendMessagesRequest: ({ messages, body }) => {
        const latest = latestProps.current;
        return { body: {
          ...body,
          dive: latest.diveKey,
          state: latest.state || {},
          ...(latest.model ? { model: latest.model } : {}),
          conversationId: conversationId.current,
          ...(previousTier(messages) ? { previousModel: previousTier(messages) } : {}),
          messages: prepareChatHistory(messages),
        } };
      },
    }),
    [],
  );
  const initialMessages = useMemo(() => readChatHistory(diveKey), [diveKey]);

  const { messages, sendMessage, setMessages, stop, regenerate, status, error } = useChat({ transport, messages: initialMessages, throttle: 50 });
  useEffect(() => {
    writeChatHistory(diveKey, messages);
    // The server may start a new saved conversation (for example after a retention purge).
    const saved = messages.findLast((message) => message.metadata?.conversationId)?.metadata.conversationId;
    if (saved && saved !== conversationId.current) {
      conversationId.current = saved;
      SESSION_CONVERSATIONS.set(diveKey, saved);
    }
  }, [messages, diveKey]);
  const busy = status === "submitted" || status === "streaming";
  const [showHistory, setShowHistory] = useState(false);
  const canAsk = ready && Boolean(diveKey);
  const waiting = frameStatus === 'error' ? COPY.unavailable : frameStatus === 'configuration' ? COPY.connect : COPY.waiting;
  const ask = (text) => {
    const trimmed = String(text || "").trim();
    if (!trimmed || !canAsk || busy) return;
    return sendMessage({ text: trimmed });
  };
  const clear = () => {
    if (busy) stop();
    setMessages([]);
    SESSION_CONVERSATIONS.delete(diveKey);
    conversationId.current = conversationIdFor(diveKey);
  };
  const openSaved = (conversation) => {
    if (busy) stop();
    setMessages(savedMessages(conversation));
    conversationId.current = conversation.id;
    SESSION_CONVERSATIONS.set(diveKey, conversation.id);
    setShowHistory(false);
  };
  const chooseModel = (value) => {
    if (!catalog?.models.includes(value)) return;
    setModel(value);
    writeStoredModel(value);
  };

  const last = messages.at(-1);
  const awaitingFirstToken = busy && (last?.role !== "assistant" || !(last.parts || []).some((part) => (part.type === "text" && part.text) || isThinkingPart(part)));
  const followUps = !busy && last?.role === "assistant" ? followUpQuestions(last) : [];
  const starters = dive?.starters?.length ? dive.starters : COPY.starters;
  const usedModels = new Set(messages.map((message) => message.metadata?.model).filter(Boolean));
  const modelItems = Object.fromEntries((catalog?.models || []).map((key) => [key, MODEL_NAMES[key] || key]));
  // A public demo lists the tiers it switched off, greyed out, so visitors see what exists.
  const unavailable = Array.isArray(catalog?.unavailable) ? catalog.unavailable : [];
  const recordingNotice = !catalog?.recording ? "" : !catalog.publicDemo ? COPY.recording : catalog.retentionDays ? fill(COPY.demoRetention, { days: catalog.retentionDays }) : COPY.demoRecording;
  const rateLimited = String(error?.message || "").includes("chat_rate_limited");
  const budgetReached = String(error?.message || "").includes("chat_budget_reached");
  const budgetMessage = () => {
    let resetsAt = null;
    try { resetsAt = JSON.parse(error.message).resetsAt; } catch { /* the date is optional */ }
    return fill(COPY.budget, { date: resetsAt ? new Date(resetsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" }) : "the 1st" });
  };

  return (
    <aside className="chat-panel" aria-label={COPY.title}>
      <ChatHeader onClear={clear} onClose={onClose} canClear={messages.length > 0 || busy} onHistory={catalog?.recording && diveKey ? () => setShowHistory((value) => !value) : undefined} historyOpen={showHistory} />

      {showHistory ? (
        <ConversationHistory diveKey={diveKey} current={messages.length ? conversationId.current : null} demo={Boolean(catalog?.publicDemo)} onOpen={openSaved} onNew={() => { clear(); setShowHistory(false); }} onDeleted={(id) => { if (id === conversationId.current) clear(); }} />
      ) : (
      <>
      <Conversation className="chat-conversation">
        <ConversationContent data-slot="conversation-content">
          {!messages.length && <ConversationEmptyState title={canAsk ? COPY.empty : waiting} description="" />}
          {messages.map((message, index) => (
            <ChatMessage key={message.id} message={message} working={busy && index === messages.length - 1} showModel={usedModels.size > 1} canRate={Boolean(catalog?.recording)} />
          ))}
          {awaitingFirstToken && <p className="chat-tool-pending" role="status">{COPY.thinking}</p>}
          {error && <p className="chat-request-error" role="alert">{rateLimited ? COPY.rateLimited : budgetReached ? budgetMessage() : String(error?.message || "").includes("chat_not_allowed") ? COPY.deniedBody : COPY.error}</p>}
          {followUps.length > 0 && canAsk && (
            <div className="chat-follow-ups">
              <span className="chat-tool-label">{COPY.followUps}</span>
              <Suggestions className="chat-suggestion-list">
                {followUps.map((question) => (
                  <Suggestion key={question} suggestion={question} onClick={ask} className="chat-suggestion" />
                ))}
              </Suggestions>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label={COPY.latest} />
      </Conversation>

      {!messages.length && canAsk && (
        <Suggestions className="chat-suggestion-list chat-starters" role="group" aria-label="Suggested questions">
          {starters.map((suggestion) => (
            <Suggestion key={suggestion} suggestion={suggestion} onClick={ask} disabled={busy} className="chat-suggestion" />
          ))}
        </Suggestions>
      )}
      </>
      )}

      <div className="chat-panel-footer" style={showHistory ? { display: "none" } : undefined}>
        {status === "error" && !rateLimited && !budgetReached && (
          <Button type="button" variant="ghost" size="sm" onClick={() => regenerate()}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />{COPY.retry}
          </Button>
        )}
        {busy && (
          <Button type="button" variant="ghost" size="sm" onClick={() => stop()}>
            <Square data-icon="inline-start" aria-hidden="true" />{COPY.stop}
          </Button>
        )}
        <PromptInput className="chat-prompt" onSubmit={({ text }) => ask(text)}>
          <PromptInputBody>
            <PromptInputTextarea disabled={!canAsk} placeholder={COPY.placeholder} />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              {catalog?.models.length + unavailable.length > 1 ? (
                <PromptInputSelect items={modelItems} value={model} onValueChange={chooseModel} disabled={busy}>
                  <PromptInputSelectTrigger size="sm" className="chat-model-trigger" aria-label={COPY.model}>
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent className={unavailable.length ? "w-max max-w-[calc(100vw-2rem)]" : undefined}>
                    {catalog.models.map((key) => (
                      <PromptInputSelectItem key={key} value={key}>
                        <span className="chat-model-name">{MODEL_NAMES[key] || key}</span>
                        <span className="chat-model-hint">{COPY.modelHint[key]}</span>
                      </PromptInputSelectItem>
                    ))}
                    {unavailable.map((key) => (
                      <PromptInputSelectItem key={key} value={key} disabled>
                        <span className="chat-model-name">{MODEL_NAMES[key] || key}</span>
                        <span className="chat-model-hint">{COPY.demoUnavailable}</span>
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>
              ) : (
                <span className="chat-ready-state">{!canAsk && waiting}</span>
              )}
            </PromptInputTools>
            <PromptInputSubmit aria-label={COPY.send} title={COPY.send} status={status} disabled={!canAsk || busy} />
          </PromptInputFooter>
        </PromptInput>
        {recordingNotice && <p className="chat-recording-notice">{recordingNotice}</p>}
      </div>
    </aside>
  );
}
