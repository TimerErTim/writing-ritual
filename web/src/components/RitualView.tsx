"use client";

import { hasFlag } from "country-flag-icons";
import { useMemo, useState } from "react";
import { useTable, useReducer } from "spacetimedb/react";
import { tables, reducers } from "@/module_bindings";
import type { Message } from "@/module_bindings/types";

const FLAG_CDN_BASE = "https://purecatamphetamine.github.io/country-flag-icons/3x2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMessageTime(sent: Message["sent"]): string {
  if (sent == null) return "—";
  const date = sent.toDate();
  return date.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function getCountryTag(location: Message["location"]): string {
  if (!location || typeof location !== "object") return "";
  return "tag" in location ? String((location as { tag: string }).tag) : "";
}

function formatCountry(location: Message["location"]): string {
  const tag = getCountryTag(location);
  return tag ? tag.toUpperCase() : "—";
}

/** High-quality SVG flag from country-flag-icons CDN (ISO 3166-1 alpha-2). */
function CountryFlag({
  code,
  title,
  className,
}: {
  code: string;
  title?: string;
  className?: string;
}) {
  const upper = code.toUpperCase();
  if (!upper || !hasFlag(upper)) return null;
  return (
    <img
      src={`${FLAG_CDN_BASE}/${upper}.svg`}
      alt=""
      title={title ?? upper}
      className={className}
      width={24}
      height={16}
    />
  );
}

// ---------------------------------------------------------------------------
// Message subcomponents
// ---------------------------------------------------------------------------

type MessageItem = Message & { type: "ghost" | "initiator" };

function GhostMessageBubble({ message }: { message: Message }) {
  const countryTag = getCountryTag(message.location);
  const code = countryTag ? countryTag.toUpperCase() : "";
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-stone-600/80 px-4 py-2 text-stone-100">
        <p className="text-sm whitespace-pre-wrap wrap-break-word">
          {message.text || "\u00A0"}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-400">
          {formatMessageTime(message.sent)}
          <span className="text-stone-500">·</span>
          <CountryFlag code={code} title={code} className="inline-block size-4 rounded-sm object-cover" />
          {formatCountry(message.location)}
        </p>
      </div>
    </div>
  );
}

function InitiatorMessageBubble({ message }: { message: Message }) {
  const countryTag = getCountryTag(message.location);
  const code = countryTag ? countryTag.toUpperCase() : "";
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-amber-900/60 px-4 py-2 text-amber-100">
        <p className="text-sm whitespace-pre-wrap wrap-break-word">
          {message.text || "\u00A0"}
        </p>
        <p className="mt-1 flex items-center justify-end gap-1.5 text-xs text-amber-200/70">
          {formatMessageTime(message.sent)}
          <span className="text-amber-200/50">·</span>
          <CountryFlag code={code} title={code} className="inline-block size-4 rounded-sm object-cover" />
          {formatCountry(message.location)}
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ item }: { item: MessageItem }) {
  return item.type === "ghost" ? (
    <GhostMessageBubble message={item} />
  ) : (
    <InitiatorMessageBubble message={item} />
  );
}

function GhostWritingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-stone-600/80 px-4 py-2 text-stone-300">
        <span className="inline-flex gap-1">
          <span className="h-2 w-2 rounded-full bg-stone-400 animate-bounce [animation-delay:-0.3s]" />
          <span className="h-2 w-2 rounded-full bg-stone-400 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-2 w-2 rounded-full bg-stone-400 animate-bounce" />
        </span>
        <span className="text-sm">Ghost is writing…</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function RitualView() {
  const [sessionRows] = useTable(tables.user_active_session);
  const currentSession = sessionRows?.[0];
  const submitMessageReducer = useReducer(reducers.submitMessage);

  const [input, setInput] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSend =
    currentSession &&
    !currentSession.isComplete && currentSession.state.tag === "WaitingForInitiator";

  const showWritingIndicator =
    currentSession &&
    !currentSession.isComplete &&
    currentSession.state.tag === "GhostWriting";

  const mergedMessages = useMemo(() => {
    if (!currentSession) return [];
    const ghost = (currentSession.ghostMessages ?? []).map((m: Message) => ({
      ...m,
      type: "ghost" as const,
    }));
    const initiator = (currentSession.initiatorMessages ?? []).map(
      (m: Message) => ({ ...m, type: "initiator" as const })
    );
    const all: Array<Message & { type: "ghost" | "initiator" }> = [];
    const maxLen = Math.max(ghost.length, initiator.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < ghost.length) all.push(ghost[i]);
      if (i < initiator.length) all.push(initiator[i]);
    }
    return all;
  }, [currentSession]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const t = input.trim();
    if (!t || !canSend) return;
    try {
      await submitMessageReducer({ text: t, location: { tag: "Us" } });
      setInput("");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to send");
    }
  };

  if (!currentSession) {
    return (
      <section className="flex-1 flex items-center justify-center p-6 text-stone-500">
        <p>No active session. Start a ritual from the map.</p>
      </section>
    );
  }

  return (
    <section className="flex-1 flex flex-col min-h-0 border-t border-stone-700/50">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {mergedMessages.map((item) => (
          <MessageBubble key={`${item.type}-${item.messageId}`} item={item} />
        ))}
        {showWritingIndicator && <GhostWritingIndicator />}
      </div>
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-stone-700/50 bg-stone-900/50"
      >
        {submitError && (
          <p className="text-red-400 text-sm mb-2">{submitError}</p>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              canSend
                ? "Speak to the spirit…"
                : currentSession.isComplete
                  ? "Session ended"
                  : "Wait for the ghost…"
            }
            disabled={!canSend}
            className="flex-1 rounded-xl bg-stone-800 text-stone-100 placeholder-stone-500 border border-stone-600 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-600/50 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!canSend || !input.trim()}
            className="rounded-xl bg-amber-800 text-amber-100 px-4 py-2.5 font-medium hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
