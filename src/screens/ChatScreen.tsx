// AI Scrap Assistant — free-form chat, history on-device, clearable.

import { useState, useEffect, useRef } from "react";
import { Loader2, Send, Trash2, AlertTriangle } from "lucide-react";
import { chatWithScout, ChatMessage } from "../lib/scout";
import { loadChat, saveChat, clearChat } from "../lib/chatstore";

const STARTERS = [
  "How do I strip insulated wire without burning it?",
  "Copper #1 vs #2 — what's the difference?",
  "What should I separate before a yard run?",
  "Is an old water heater worth hauling?",
];

export default function ChatScreen({ onAiAction }: { onAiAction?: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadChat().then(setMessages);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim().slice(0, 1000);
    if (!content || busy) return;
    setError(null);
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setBusy(true);
    try {
      const reply = await chatWithScout(next);
      onAiAction?.(); // successful answers only — failures stay free
      const withReply: ChatMessage[] = [...next, { role: "assistant", content: reply }];
      setMessages(withReply);
      await saveChat(withReply);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't get an answer. Try again.");
      // Keep the user's question so a retry doesn't retype it
      setInput(content);
      setMessages(messages);
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    setMessages([]);
    setConfirmClear(false);
    await clearChat();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 mt-4">
            <div className="text-sm text-faint text-center max-w-xs mx-auto">
              Ask anything about scrapping, separating metals, yard runs, or flipping. Plain
              answers, no lectures.
            </div>
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-left bg-panel border border-edge rounded-xl px-4 py-3 text-sm text-mist"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
              m.role === "user" ? "self-end text-ink" : "self-start bg-panel border border-edge text-mist"
            }`}
            style={m.role === "user" ? { background: "#4ADE80" } : undefined}
          >
            {m.content}
          </div>
        ))}

        {busy && (
          <div className="self-start bg-panel border border-edge rounded-2xl px-4 py-2.5">
            <Loader2 size={16} className="animate-spin" color="#4ADE80" />
          </div>
        )}

        {error && (
          <div className="bg-panel border-2 border-alert rounded-xl p-3 text-sm flex gap-2">
            <AlertTriangle size={16} className="flex-shrink-0" color="#F87171" />
            <span>{error}</span>
          </div>
        )}

        {messages.length > 0 && (
          <div className="self-center pt-2">
            {confirmClear ? (
              <div className="flex gap-2 items-center text-xs">
                <span className="text-faint">Clear this chat?</span>
                <button
                  onClick={doClear}
                  className="px-3 py-1 rounded font-semibold"
                  style={{ background: "#F87171", color: "#0A0E1A" }}
                >
                  Clear
                </button>
                <button onClick={() => setConfirmClear(false)} className="px-3 py-1 rounded border border-edge text-mist">
                  Keep
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmClear(true)} className="text-xs text-faint underline flex items-center gap-1">
                <Trash2 size={11} /> clear chat
              </button>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-edge bg-panel p-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask the scout..."
          className="min-w-0 flex-1 bg-ink border border-edge rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-scout"
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          className="px-4 rounded-xl disabled:opacity-40 flex items-center justify-center"
          style={{ background: "#4ADE80" }}
          aria-label="Send"
        >
          <Send size={18} color="#0A0E1A" />
        </button>
      </div>
      <div className="bg-panel px-4 pb-2 text-[10px] text-faint text-center">
        AI advice — it won't quote live prices (they move). Check the Prices tab and call your yard.
      </div>
    </div>
  );
}
