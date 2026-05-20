import { useState, useRef, useEffect, useCallback } from "react";
import { format, isToday, isYesterday } from "date-fns";
import {
  Send, Bot, ArrowLeft,
  Mic, Search, MoreVertical, Smile, Paperclip,
  Play, Pause, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { avatarColor } from "@/lib/avatar-color";
import type { Message, Conversation } from "@/lib/contracts/schema-types";
import { useSendMessage, useMessages } from "@/hooks/use-messages";
// ESCALATION — hidden for now
// import { useCloseEscalation } from "@/hooks/use-escalations";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/ui/Logo";

function formatDateSeparator(date: Date): string {
  if (isToday(date)) return "TODAY";
  if (isYesterday(date)) return "YESTERDAY";
  return format(date, "MMMM d, yyyy").toUpperCase();
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/* Brand read-receipt double-tick — brand-cyan for delivered + read. */
function ReadReceipt({ isCustomer }: { isCustomer: boolean }) {
  if (isCustomer) return null;
  return (
    <span className="inline-flex ms-1 -me-0.5">
      <svg width="16" height="11" viewBox="0 0 16 11" className="text-brand-cyan">
        <path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.011-2.095a.463.463 0 0 0-.336-.153.457.457 0 0 0-.344.153.441.441 0 0 0 0 .637l2.345 2.442a.452.452 0 0 0 .336.153.465.465 0 0 0 .372-.178l6.541-8.07a.45.45 0 0 0-.028-.601z" fill="currentColor" />
        <path d="M15.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-1.2-1.25-.735.908 1.6 1.667a.452.452 0 0 0 .336.153.465.465 0 0 0 .372-.178l6.541-8.07a.45.45 0 0 0-.04-.642z" fill="currentColor" />
      </svg>
    </span>
  );
}

function VoiceNotePlayer({ message, isCustomer }: { message: Message; isCustomer: boolean }) {
  const { t } = useLanguage();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animRef = useRef<number>(0);
  const hasTranscription = message.transcription && message.transcription.trim().length > 0;

  const tick = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setProgress(a.duration ? a.currentTime / a.duration : 0);
    if (!a.paused) animRef.current = requestAnimationFrame(tick);
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
      animRef.current = requestAnimationFrame(tick);
    } else {
      a.pause();
      setPlaying(false);
      cancelAnimationFrame(animRef.current);
    }
  };

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const formatDur = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const bars = Array.from({ length: 32 }, (_, i) => {
    const seed = ((message.id ?? 0) * 7 + i * 13) % 100;
    return 0.15 + (seed / 100) * 0.85;
  });

  // Accent color depends on bubble: customer (inbound) uses brand-cyan as an
  // accent on dark navy; agent (outbound) uses white-on-gradient.
  const accentText = isCustomer ? "text-brand-cyan" : "text-white";
  const accentMuted = isCustomer ? "text-brand-cyan/40" : "text-white/40";
  const accentBg = isCustomer ? "bg-brand-cyan/15" : "bg-white/15";
  const accentBgStrong = isCustomer ? "bg-brand-cyan" : "bg-white";
  const accentBgFaint = isCustomer ? "bg-brand-cyan/30" : "bg-white/30";

  return (
    <div className="flex flex-col gap-1.5 min-w-[240px]">
      {message.media_url && (
        <audio
          ref={audioRef}
          src={message.media_url}
          preload="metadata"
          onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
          onEnded={() => { setPlaying(false); setProgress(0); }}
        />
      )}
      <div className="flex items-center gap-2.5">
        <button
          onClick={toggle}
          disabled={!message.media_url}
          className={cn("w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-colors", accentBg)}
        >
          {playing ? (
            <Pause className={cn("w-5 h-5", accentText)} />
          ) : (
            <Play className={cn("w-5 h-5 ms-0.5", accentText)} />
          )}
        </button>

        <div className="flex-1 flex flex-col gap-1">
          <div className="flex items-end gap-px h-5">
            {bars.map((h, i) => (
              <div
                key={i}
                className={cn(
                  "w-[3px] rounded-full transition-colors duration-75",
                  i / bars.length <= progress ? accentBgStrong : accentBgFaint
                )}
                style={{ height: `${h * 100}%` }}
              />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className={cn("text-[11px]", isCustomer ? "text-brand-slate" : "text-white/70")}>
              {duration > 0 ? formatDur(playing ? progress * duration : duration) : "0:00"}
            </span>
            <Mic className={cn("w-3 h-3", accentMuted)} />
          </div>
        </div>
      </div>

      {hasTranscription && (
        <div className={cn(
          "text-[11px] italic rounded-md px-2 py-1.5 mt-0.5",
          isCustomer ? "text-brand-slate bg-white/[0.04]" : "text-white/80 bg-white/10",
        )}>
          <FileText className={cn("w-3 h-3 inline me-1 -mt-0.5", isCustomer ? "text-brand-slate" : "text-white/60")} />
          {t("voiceNoteTranscription")}: {message.transcription}
        </div>
      )}
    </div>
  );
}

export function ChatArea({
  conversation,
  onClose,
}: {
  conversation: Conversation | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-brand-ink relative overflow-hidden">
        {/* Subtle centered brand-blue glow */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(0,102,255,0.10),transparent_60%)]" />
        <div className="relative flex flex-col items-center text-center px-6">
          <Logo size={80} priority />
          <h3 className="text-xl font-semibold text-white mt-6">{t("chatSelectConversation")}</h3>
          <p className="text-sm text-brand-slate mt-2 max-w-sm">{t("chatSelectPrompt")}</p>
        </div>
      </div>
    );
  }

  return <ActiveChat conversation={conversation} onClose={onClose} />;
}

interface Agent { id: number; name: string; email: string; is_active: boolean; }

function ActiveChat({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const { data: messages = [], isLoading } = useMessages(conversation.customer_phone);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  // ESCALATION — hidden for now
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setAgents] = useState<Agent[]>([]);
  const { t } = useLanguage();

  useEffect(() => {
    if (isAdmin) {
      fetch("/api/agents", { credentials: "include" })
        .then(r => (r.ok ? r.json() : []))
        .then(data => setAgents(data.filter((a: Agent) => a.is_active)))
        .catch(() => {});
    }
  }, [isAdmin]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isSending) return;
    sendMessage(
      { customer_phone: conversation.customer_phone, message: text },
      {
        onSuccess: () => setText(""),
        onError: (err: Error) => {
          toast({
            title: "Message not sent",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const isOpen = conversation.escalation_status !== "closed";
  const phoneStr = conversation.customer_phone;
  const avatarInitials = phoneStr.startsWith("+") ? phoneStr.slice(1, 3) : phoneStr.slice(-2);
  const tone = avatarColor(phoneStr);

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 relative bg-brand-ink">
      {/* Header bar — brand surface, replaces WhatsApp green */}
      <div className="px-4 py-2 bg-brand-navy border-b border-white/[0.06] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.06] transition-colors">
            <ArrowLeft className="w-5 h-5 text-white icon-directional" />
          </button>
          <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", tone.bg)}>
            <span className={cn("text-sm font-semibold", tone.text)}>{avatarInitials}</span>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-white leading-tight">{conversation.customer_phone}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn(
                "w-2 h-2 rounded-full",
                isOpen ? "bg-brand-emerald" : "bg-brand-slate"
              )} />
              <span className="text-[12px] text-brand-slate">
                {isOpen ? t("chatStatusOnline") : t("chatStatusOffline")}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/[0.06] transition-colors">
            <Search className="w-[18px] h-[18px] text-brand-slate" />
          </button>
          <button className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/[0.06] transition-colors">
            <MoreVertical className="w-[18px] h-[18px] text-brand-slate" />
          </button>
        </div>
      </div>

      {/* Messages area — brand ink with a soft top-centered brand-blue glow */}
      <div className="flex-1 min-h-0 overflow-y-auto px-[6%] md:px-[10%] lg:px-[14%] py-3 relative">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,102,255,0.06),transparent_60%)]" />
        <div className="relative">
          {messages.map((msg, idx) => {
            const msgDate = new Date(msg.created_at!);
            const prevDate = idx > 0 ? new Date(messages[idx - 1].created_at!) : null;
            const showDateSep = idx === 0 || (prevDate && !isSameDay(msgDate, prevDate));
            const isFirst = idx === 0 || messages[idx - 1].sender !== msg.sender || !!showDateSep;
            return (
              <div key={msg.id}>
                {showDateSep && (
                  <div className="flex justify-center my-3">
                    <span className="text-[11px] font-medium text-brand-slate bg-brand-navy border border-white/[0.06] rounded-full px-3 py-1.5">
                      {formatDateSeparator(msgDate)}
                    </span>
                  </div>
                )}
                <MessageBubble message={msg} showTail={isFirst} />
              </div>
            );
          })}

          {/* Streaming indicator — three pulsing dots in brand-cyan */}
          {isLoading && messages.length === 0 && (
            <div className="flex justify-center py-8">
              <div className="bg-brand-navy border border-white/[0.06] rounded-full px-4 py-2 flex gap-1.5">
                <span className="w-2 h-2 bg-brand-cyan rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-brand-cyan rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-brand-cyan rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </div>

      {/* Composer — brand surface */}
      <div className="bg-brand-navy border-t border-white/[0.06] px-3 py-2 shrink-0">
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <button type="button" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/[0.06] transition-colors shrink-0">
            <Smile className="w-[22px] h-[22px] text-brand-slate" />
          </button>
          <button type="button" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/[0.06] transition-colors shrink-0">
            <Paperclip className="w-[22px] h-[22px] text-brand-slate rotate-45" />
          </button>
          <div className="flex-1 bg-brand-ink border border-white/[0.08] rounded-xl px-3 py-2">
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={t("chatReplyPlaceholder")}
              className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-[15px] text-white placeholder:text-brand-slate"
              disabled={isSending}
            />
          </div>
          {text.trim() ? (
            <button
              type="submit"
              disabled={isSending}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-gradient-primary hover:brightness-110 disabled:opacity-50 transition-all shrink-0"
            >
              <Send className="w-[18px] h-[18px] text-white icon-directional" />
            </button>
          ) : (
            <button type="button" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/[0.06] transition-colors shrink-0">
              <Mic className="w-[22px] h-[22px] text-brand-slate" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message, showTail }: { message: Message; showTail: boolean }) {
  const { t, isRTL } = useLanguage();
  const isCustomer = message.sender === "customer";
  const isAI = message.sender === "ai";
  const isVoiceNote = message.media_type === "audio";

  const time = format(new Date(message.created_at!), "h:mm a");

  return (
    <div className={cn(
      "flex w-full",
      isCustomer ? "justify-start" : "justify-end",
      showTail ? "mt-2" : "mt-[2px]"
    )}>
      <div className={cn("relative max-w-[65%]", showTail ? "" : (isCustomer ? "ms-2" : "me-2"))}>
        <div
          className={cn(
            "rounded-2xl px-3 pb-1.5 pt-2 relative shadow-sm",
            isCustomer
              ? "bg-brand-navy border border-white/[0.06] rounded-ss-md"
              : "bg-gradient-primary rounded-se-md"
          )}
        >
          {/* Sender label for AI / Agent — first bubble in a group */}
          {!isCustomer && showTail && (
            <div className={cn(
              "text-[12px] font-semibold mb-0.5 leading-tight",
              isAI ? "text-white" : "text-white"
            )}>
              {isAI && <Bot className="w-3 h-3 inline me-1 -mt-0.5" />}
              {isAI ? t("chatSenderAI") : t("chatSenderYou")}
            </div>
          )}

          {/* Content */}
          {isVoiceNote ? (
            <VoiceNotePlayer message={message} isCustomer={isCustomer} />
          ) : (
            <span
              className={cn(
                "text-[14.5px] leading-[20px] whitespace-pre-wrap break-words block",
                isCustomer ? "text-white" : "text-white"
              )}
              dir={isRTL ? "rtl" : "ltr"}
              style={isRTL ? { textAlign: "right" } : undefined}
            >
              {message.message_text}
            </span>
          )}

          {/* Inline timestamp + read receipts */}
          <span className="float-right flex items-center gap-0.5 mt-1 ms-3 -mb-0.5 relative top-[3px]">
            <span className={cn(
              "text-[11px] leading-none",
              isCustomer ? "text-brand-slate" : "text-white/70"
            )}>{time}</span>
            <ReadReceipt isCustomer={isCustomer} />
          </span>
          <span className="clear-both block h-0" />
        </div>
      </div>
    </div>
  );
}
