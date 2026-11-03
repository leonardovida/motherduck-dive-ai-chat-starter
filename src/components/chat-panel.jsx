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
  RotateCcw,
  Square,
  TableProperties,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import "./chat-panel.css";
import { prepareChatHistory } from "@/lib/chat-history.mjs";

const SESSION_CHAT_HISTORY = new Map();
// One saved-conversation id per Dive for this browser session; Clear starts a new one.
const SESSION_CONVERSATIONS = new Map();
const MAX_SESSION_MESSAGES = 24;
const MODEL_STORAGE_KEY = "dive_app_chat_model";
let catalogRequest = null;

export function clearChatHistory() {
  SESSION_CHAT_HISTORY.clear();
  SESSION_CONVERSATIONS.clear();
  catalogRequest = null;
}

function readChatHistory(key) {
  const history = SESSION_CHAT_HISTORY.get(key);
  return Array.isArray(history) ? history : [];
}

function writeChatHistory(key, messages) {
  if (!key) return;
  SESSION_CHAT_HISTORY.set(key, messages.slice(-MAX_SESSION_MESSAGES));
}

// The server decides which tiers exist; the browser only remembers a choice.
function loadModelCatalog() {
  catalogRequest ??= fetch("/api/chat", { credentials: "same-origin", cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((catalog) => (Array.isArray(catalog?.models) && catalog.models.length ? catalog : null))
    .catch(() => null)
    .then((catalog) => {
      if (!catalog) catalogRequest = null;
      return catalog;
    });
  return catalogRequest;
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
  disabledBody: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY, plus the chat token and database variables named for this Dive in dives.config.mjs, in your runtime environment.",
  deniedTitle: "Chat isn't included in your access",
  deniedBody: "Ask an administrator to turn on chat for your account.",
  recording: "Conversations are saved and can be reviewed by administrators.",
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

function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

// [singular, plural] templates pick by values.n.
function count(templates, values) {
  return fill(values.n === 1 ? templates[0] : templates[1], { ...values, n: Number(values.n).toLocaleString() });
}

const STEP_ICONS = {
  getDiveState: Eye,
  listTables: Database,
  describeTable: TableProperties,
  runQuery: Terminal,
};

function stepLabel(name, output) {
  if (name === "describeTable" && output?.table && Array.isArray(output.columns)) {
    return count(COPY.describedStep, { table: output.table, n: output.columns.length });
  }
  return COPY.steps[name] || name;
}

function stepDescription(name, output) {
  if (!output || typeof output !== "object") return null;
  if (output.error) return String(output.error);
  if (name === "getDiveState") return count(COPY.stateStep, { n: Object.keys(output.state || {}).length });
  if (name === "listTables" && Array.isArray(output.tables)) return count(COPY.tablesStep, { n: output.tables.length });
  if (name === "runQuery" && typeof output.rowCount === "number") {
    return output.truncated ? fill(COPY.rowsMoreStep, { n: output.rowCount.toLocaleString() }) : count(COPY.rowsStep, { n: output.rowCount });
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
      ? count(COPY.workedFor, { s: seconds, n: steps.length })
      : count(COPY.explored, { n: steps.length });

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

// The tier of the latest answer, so a short follow-up can keep it when routing automatically.
function previousTier(messages) {
  const tier = messages.findLast((message) => message.role === "assistant" && message.metadata?.model)?.metadata.model;
  return ["luna", "sol", "astra"].includes(tier) ? tier : undefined;
}

function ChatMessage({ message, working, showModel }) {
  const text = messageText(message);
  const tier = MODEL_NAMES[message.metadata?.model];
  // Auto answers always say which tier answered and why; manual picks only when several were used.
  const model = message.metadata?.auto && tier ? COPY.routed.replace("{model}", tier) : showModel ? tier : null;
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
            {model && <span className="chat-model-tag" title={message.metadata?.routeReason || undefined}>{model}</span>}
          </MessageActions>
        )}
      </MessageContent>
    </Message>
  );
}

function ChatHeader({ onClear, onClose, canClear }) {
  return (
    <header className="chat-panel-header">
      <div>
        <h2>{COPY.title}</h2>
        <p>{COPY.subtitle}</p>
      </div>
      <div className="chat-panel-header-actions">
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
  useEffect(() => () => {
    // Closing or moving the panel keeps the session history, but an in-flight
    // request must not continue after its owning panel unmounts.
    stop();
  }, [stop]);
  const busy = status === "submitted" || status === "streaming";
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
  const rateLimited = String(error?.message || "").includes("chat_rate_limited");

  return (
    <aside className="chat-panel" aria-label={COPY.title}>
      <ChatHeader onClear={clear} onClose={onClose} canClear={messages.length > 0 || busy} />

      <Conversation className="chat-conversation">
        <ConversationContent data-slot="conversation-content">
          {!messages.length && <ConversationEmptyState title={canAsk ? COPY.empty : waiting} description="" />}
          {messages.map((message, index) => (
            <ChatMessage key={message.id} message={message} working={busy && index === messages.length - 1} showModel={usedModels.size > 1} />
          ))}
          {awaitingFirstToken && <p className="chat-tool-pending" role="status">{COPY.thinking}</p>}
          {error && <p className="chat-request-error" role="alert">{rateLimited ? COPY.rateLimited : String(error?.message || "").includes("chat_not_allowed") ? COPY.deniedBody : COPY.error}</p>}
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

      <div className="chat-panel-footer">
        {status === "error" && !rateLimited && (
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
              {catalog?.models.length > 1 ? (
                <PromptInputSelect items={modelItems} value={model} onValueChange={chooseModel} disabled={busy}>
                  <PromptInputSelectTrigger size="sm" className="chat-model-trigger" aria-label={COPY.model}>
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    {catalog.models.map((key) => (
                      <PromptInputSelectItem key={key} value={key}>
                        <span className="chat-model-name">{MODEL_NAMES[key] || key}</span>
                        <span className="chat-model-hint">{COPY.modelHint[key]}</span>
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
        {catalog?.recording && <p className="chat-recording-notice">{COPY.recording}</p>}
      </div>
    </aside>
  );
}
