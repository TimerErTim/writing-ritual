"use client";

import { hasFlag } from "country-flag-icons";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTable, useReducer } from "spacetimedb/react";
import { tables, reducers } from "@/module_bindings";
import type { BookWordView, Iso3166Alpha2 } from "@/module_bindings/types";
import { Timestamp } from "spacetimedb";
import {
  BookOpen,
  Clock,
  Feather,
  TrendingUp,
  Users,
  Send,
  Info
} from "lucide-react";

// ---------------------------------------------------------------------------
// Config & Helpers
// ---------------------------------------------------------------------------

const FLAG_CDN_BASE = "https://purecatamphetamine.github.io/country-flag-icons/3x2";

function alpha2ToLocationTag(alpha2: string): string {
  const s = alpha2.toUpperCase().slice(0, 2);
  if (s.length !== 2) return "Us";
  return s[0] + s[1].toLowerCase();
}

/** Detect country code from browser: IP geolocation then locale fallback. */
function useDetectedLocation(): { tag: string } | null {
  const [location, setLocation] = useState<{ tag: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fromLocale = (): string => {
      try {
        const locale =
          typeof navigator !== "undefined"
            ? navigator.language || (navigator.languages && navigator.languages[0])
            : "";
        const region = locale.split("-")[1] || new Intl.Locale(locale).region || "";
        return region.toUpperCase().slice(0, 2) || "US";
      } catch {
        return "US";
      }
    };

    const apply = (alpha2: string) => {
      if (cancelled) return;
      const tag = alpha2ToLocationTag(alpha2);
      setLocation({ tag });
    };

    fetch("https://ipapi.co/json/?fields=country_code", { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .then((data) => {
        const code = (data?.country_code ?? "").toUpperCase().slice(0, 2);
        apply(code || fromLocale());
      })
      .catch(() => apply(fromLocale()));

    return () => {
      cancelled = true;
    };
  }, []);

  return location;
}

function CountryFlag({ code, className }: { code: string; className?: string }) {
  const upper = code.toUpperCase();
  if (!upper || !hasFlag(upper)) return null;
  return (
    <img
      src={`${FLAG_CDN_BASE}/${upper}.svg`}
      alt={upper}
      className={`rounded-sm object-cover shadow-sm ${className}`}
    />
  );
}

function formatTimestamp(timestamp: Timestamp): string {
  const date = timestamp.toDate();
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

/**
 * Visualizes a vote distribution using text and CSS bars.
 * No heavy libraries, just divs and math.
 */
function TextualDistribution({
  candidates
}: {
  candidates: { word: string; voteCount: number }[]
}) {
  // Sort by count descending
  const sorted = [...candidates].sort((a, b) => b.voteCount - a.voteCount);
  const total = sorted.reduce((acc, c) => acc + c.voteCount, 0);
  const max = sorted[0]?.voteCount || 1;

  return (
    <div className="flex flex-col gap-1 w-full font-mono text-xs">
      {sorted.map((c, i) => {
        const percentage = Math.round((c.voteCount / total) * 100);
        const relativeIntensity = c.voteCount / max; // 0 to 1 based on winner

        return (
          <div key={c.word} className="relative group">
            {/* The Background Bar (The Visualization) */}
            <div
              className={`absolute inset-y-0 left-0 transition-all duration-500 rounded-sm opacity-20 ${i === 0 ? 'bg-amber-500' : 'bg-stone-500'
                }`}
              style={{ width: `${percentage}%` }}
            />

            {/* The Text Layer */}
            <div className="relative flex justify-between items-center px-2 py-1 text-stone-300 z-10">
              <span className={`font-medium ${i === 0 ? 'text-amber-500' : ''}`}>
                {i + 1}. {c.word}
              </span>
              <span className="text-stone-500 group-hover:text-stone-300 transition-colors">
                {c.voteCount} <span className="opacity-50 text-[10px]">({percentage}%)</span>
              </span>
            </div>
          </div>
        );
      })}

      {candidates.length === 0 && (
        <div className="text-stone-600 italic px-2">No data recorded.</div>
      )}
    </div>
  );
}

/** * Represents an accepted word in the book. 
 * Uses 'fixed' positioning to break out of overflow containers and avoid clipping.
 */
function BookWord({ bookword }: { bookword: BookWordView }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, xOffset: -50 });

  const handleMouseEnter = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const POPOVER_WIDTH = 192; // equivalent to w-48 (12rem)
    const SCREEN_PADDING = 16;

    // 1. Calculate ideal center position
    let left = rect.left + rect.width / 2;
    let xOffset = -50; // Default: Center the popover (-50% transform)

    // 2. Left Edge Detection
    // If centering pushes it off-left, align to left edge of word
    if (left - (POPOVER_WIDTH / 2) < SCREEN_PADDING) {
      left = Math.max(SCREEN_PADDING, rect.left); // Ensure at least padding
      xOffset = 0; // Align left (0% transform)
    }
    // 3. Right Edge Detection
    // If centering pushes it off-right, align to right edge of word
    else if (left + (POPOVER_WIDTH / 2) > window.innerWidth - SCREEN_PADDING) {
      left = Math.min(window.innerWidth - SCREEN_PADDING, rect.right);
      xOffset = -100; // Align right (-100% transform)
    }

    setCoords({
      top: rect.top - 8, // 8px gap above word
      left,
      xOffset
    });
    setShowTooltip(true);
  };

  return (
    <>
      <span
        ref={triggerRef}
        className="relative inline-block cursor-help transition-colors duration-300 text-stone-200 hover:text-amber-400 border-b border-transparent hover:border-amber-500/50 mb-0.5"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {bookword.word}
      </span>

      {/* Render Tooltip with Fixed Position 
         We render it as a sibling here, but 'fixed' breaks it out of the overflow container
      */}
      {showTooltip && (
        <div
          className="fixed z-100 w-48 bg-stone-900 border border-stone-700 rounded-lg shadow-xl shadow-black/80 pointer-events-none animate-in fade-in zoom-in-95 duration-150"
          style={{
            top: coords.top,
            left: coords.left,
            transform: `translate(${coords.xOffset}%, -100%)`, // Move up and shift X
          }}
        >
          <div className="p-3 text-xs">
            <div className="font-bold text-amber-500 mb-1 border-b border-stone-800 pb-1 flex items-center gap-2">
              <Feather size={12} />
              Accepted Word
            </div>
            <div className="flex justify-between text-stone-400 mb-1">
              <span>{formatTimestamp(bookword.decidedAt)}</span>
            </div>
            <TextualDistribution candidates={bookword.votesDistribution} />
          </div>

          {/* Dynamic Arrow 
             We hide the arrow if we are edge-aligned to keep it simple, 
             or we could calculate its position too. For cleanliness, we omit it or center it carefully.
             Here is a simple centered arrow that works for the default case:
          */}
          {coords.xOffset === -50 && (
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-stone-900 border-r border-b border-stone-700 transform rotate-45"></div>
          )}
        </div>
      )}
    </>
  );
}

/** * Visualizes the current voting battle.
 * Words scale in size based on vote count.
 */
function VotingArena({ candidates }: { candidates: { word: string; votesAmount: number }[] }) {
  const totalVotes = useMemo(() =>
    candidates.reduce((acc, c) => acc + c.votesAmount, 0)
    , [candidates]);

  const sortedCandidates = useMemo(() =>
    [...candidates].sort((a, b) => b.votesAmount - a.votesAmount)
    , [candidates]);

  if (candidates.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-stone-500 italic">
        <BookOpen size={48} className="mb-4 opacity-20" />
        <p>The page is blank. Cast the first vote.</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden relative">
      <div className="flex flex-wrap items-center justify-center gap-4 content-center h-full p-4">
        {sortedCandidates.map((c) => {
          // Calculate scale. Base 1rem, max 3rem based on percentage
          const percentage = totalVotes > 0 ? c.votesAmount / totalVotes : 0;
          const fontSize = Math.max(1, 1 + (percentage * 2.5)); // 1rem to 3.5rem
          const opacity = Math.max(0.6, 0.4 + (percentage * 0.6));

          return (
            <div
              key={c.word}
              className="flex flex-col items-center transition-all duration-500 ease-out"
              style={{ transform: `scale(${1 + (percentage * 0.2)})` }} // Subtle zoom
            >
              <span
                className="font-bold text-stone-200 leading-none transition-all duration-500"
                style={{ fontSize: `${fontSize}rem`, opacity }}
              >
                {c.word}
              </span>
              <span className="text-xs text-amber-500/80 font-mono mt-1 flex items-center gap-1">
                <Users size={10} />
                {c.votesAmount} ({Math.round(percentage * 100)}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Handles the countdown logic locally to avoid re-rendering parent too often
 */
function VoteTimer({ endsAt }: { endsAt?: number }) {
  const [timeLeft, setTimeLeft] = useState<string>("...");

  useEffect(() => {
    if (!endsAt) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.max(0, Math.ceil((endsAt - now) / 1000));
      setTimeLeft(diff.toString());
    }, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  if (!endsAt) return null;

  return (
    <div className="flex items-center gap-2 text-amber-500 font-mono text-sm bg-amber-950/30 px-3 py-1 rounded-full border border-amber-900/50">
      <Clock size={14} className="animate-pulse" />
      <span>{timeLeft}s remaining</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export function MainView() {
  const detectedLocation = useDetectedLocation();
  const [book] = useTable(tables.current_book_view);
  const [myVote] = useTable(tables.my_vote);
  const [currentWordVotes] = useTable(tables.current_word_votes);
  const submitVote = useReducer(reducers.voteForWord);

  console.log(detectedLocation);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSend = myVote.length === 0;

  // Auto-scroll to bottom of book
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [book]);

  // Derived state
  const currentCandidates = currentWordVotes[0]?.candidates || [];
  const votingEndsMillis = currentWordVotes[0]?.votingEnds?.toMillis?.();

  // Autocomplete Suggestions
  const suggestions = useMemo(() => {
    if (!input.trim()) return [];
    const lowerInput = input.toLowerCase();
    return currentCandidates
      .filter(c => c.word.toLowerCase().startsWith(lowerInput))
      .sort((a, b) => b.votesAmount - a.votesAmount)
      .slice(0, 3); // Top 3 matches
  }, [input, currentCandidates]);

  const handleVote = async (wordToVote: string) => {
    if (!wordToVote || !canSend) return;

    setIsSubmitting(true);
    const location: Iso3166Alpha2 = (detectedLocation ?? { tag: "Us" }) as Iso3166Alpha2;

    try {
      await submitVote({ word: wordToVote, location });
      setInput("");
      setShowSuggestions(false);
    } catch (e) {
      console.error(e);
      // Ideally show a toast here
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleVote(input.trim());
  };

  return (
    <div className="flex flex-col h-full bg-stone-950 text-stone-200 font-sans selection:bg-amber-900/50">

      {/* HEADER */}
      <header className="shrink-0 h-14 border-b border-stone-800 bg-stone-900/50 backdrop-blur-md flex items-center justify-between px-6 z-10">
        <div className="flex items-center gap-2 text-amber-500">
          <Feather className="w-5 h-5" />
          <h1 className="font-serif font-bold text-lg tracking-wide text-stone-200">The Ritual</h1>
        </div>
        <div className="flex items-center gap-4">
          {/* Active Vote Stats (Mini) */}
          <div className="hidden sm:flex items-center gap-2 text-xs text-stone-500">
            <Users size={14} />
            <span>{currentCandidates.reduce((a, b) => a + b.votesAmount, 0)} votes cast</span>
          </div>
          <VoteTimer endsAt={Number(votingEndsMillis)} />
        </div>
      </header>

      {/* MAIN CONTENT SPLIT */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">

        {/* LEFT: THE BOOK (History) */}
        <section className="flex-2 flex flex-col min-h-0 border-r border-stone-800 bg-stone-950/50 relative">
          <div className="absolute top-4 right-4 z-10 opacity-20 pointer-events-none">
            <BookOpen size={120} />
          </div>

          <div className="flex-1 overflow-y-auto p-8 md:p-12 font-serif text-lg md:text-xl leading-relaxed text-stone-300 scrollbar-thin scrollbar-thumb-stone-800 scrollbar-track-transparent">
            {book[0]?.words.length === 0 && (
              <div className="text-stone-600 italic mt-20 text-center">
                The pages are empty. History begins with you.
              </div>
            )}

            <div className="max-w-3xl mx-auto space-x-1.5">
              {book[0]?.words.map((word, i) => (
                <Fragment key={word.decidedAt.toMillis()}>
                  <BookWord bookword={word} />
                </Fragment>
              ))}
              <span ref={messagesEndRef} className="inline-block w-2 h-5 bg-amber-500/50 animate-pulse align-middle ml-1" />
            </div>
          </div>
        </section>

        {/* RIGHT: THE ARENA (Current Vote) */}
        <section className="flex-1 flex flex-col min-h-0 bg-stone-900/30 border-t md:border-t-0 md:border-l border-stone-800">

          {/* Header */}
          <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between bg-stone-900/50">
            <span className="text-xs font-bold uppercase tracking-wider text-stone-500 flex items-center gap-2">
              <TrendingUp size={14} />
              Current Vote Distribution
            </span>
          </div>

          {/* Visualizer */}
          <div className="flex-1 min-h-0 relative">
            <VotingArena candidates={currentCandidates} />
          </div>

          {/* Input Area */}
          <div className="shrink-0 p-4 bg-stone-900 border-t border-stone-800 relative z-20">

            {/* Suggestion Popover */}
            {showSuggestions && suggestions.length > 0 && canSend && (
              <div className="absolute bottom-full left-4 right-4 mb-2 bg-stone-800 border border-stone-700 rounded-lg shadow-xl overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200">
                <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-stone-500 bg-stone-900/50 border-b border-stone-700">
                  Trending Suggestions
                </div>
                {suggestions.map((s) => (
                  <button
                    key={s.word}
                    onClick={() => handleVote(s.word)}
                    className="w-full text-left px-4 py-2 hover:bg-amber-900/30 text-stone-300 hover:text-amber-100 flex justify-between group transition-colors"
                  >
                    <span>{s.word}</span>
                    <span className="text-stone-500 text-xs group-hover:text-amber-400/70">
                      {s.votesAmount} votes
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="relative">
              {!canSend ? (
                <div className="inset-0 z-10 bg-stone-900/80 backdrop-blur-sm rounded-xl flex items-center justify-center border border-stone-700">
                  <div className="text-center">
                    <p className="text-stone-400 text-sm font-medium mb-1">
                      Vote Submitted: <span className="text-amber-400 font-bold">{myVote[0]?.word}</span>
                    </p>
                    <p className="text-xs text-stone-600">Waiting for next round...</p>
                  </div>
                </div>
              ) :

                <div className="flex gap-2">
                  <div className="relative flex-1 group">
                    <input
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setShowSuggestions(true);
                      }}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} // Delay for click handling
                      placeholder="Propose the next word..."
                      className="w-full bg-stone-950 text-stone-100 placeholder-stone-600 border border-stone-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-900/50 focus:border-amber-700 transition-all font-serif tracking-wide"
                      autoComplete="off"
                    />
                    {detectedLocation && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 group-focus-within:opacity-100 transition-opacity">
                        <CountryFlag code={detectedLocation.tag} className="w-5 h-auto rounded-[2px]" />
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={!input.trim() || isSubmitting}
                    className="bg-amber-700 hover:bg-amber-600 text-white rounded-xl px-5 py-3 font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-900/20"
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </div>}
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}