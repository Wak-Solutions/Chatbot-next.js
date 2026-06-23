import { useState } from "react";
import { isToday, isYesterday, format } from "date-fns";
import { MessageSquare, Search, User, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { useAuth } from "@/hooks/use-auth";
import { avatarColor } from "@/lib/avatar-color";
import NewChatModal from "@/components/NewChatModal";
import type { Conversation } from "@/lib/contracts/schema-types";

function agentInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

type FilterType = "all" | "open" | "closed";

interface SidebarProps {
  conversations: Conversation[];
  selectedPhone: string | null;
  onSelect: (phone: string) => void;
}

function formatConversationTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "M/d/yy");
}

function getInitials(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4, -2);
  return digits.slice(-2);
}

export function Sidebar({ conversations, selectedPhone, onSelect }: SidebarProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [myOnly, setMyOnly] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const { t } = useLanguage();
  const { agentId } = useAuth();

  const filteredByStatus =
    filter === "open"
      ? conversations.filter(c => c.escalation_status !== "closed")
      : filter === "closed"
        ? conversations.filter(c => c.escalation_status === "closed")
        : conversations;

  const filteredByOwner = myOnly
    ? filteredByStatus.filter(c => c.assigned_agent_id === agentId)
    : filteredByStatus;

  const visible = searchQuery.trim()
    ? filteredByOwner.filter(c =>
        c.customer_phone.includes(searchQuery) ||
        (c.customer_name && c.customer_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.last_message && c.last_message.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : filteredByOwner;

  const tabs: { key: FilterType; label: string }[] = [
    { key: "all", label: t("sidebarFilterAll") },
    { key: "open", label: t("sidebarFilterActive") },
    { key: "closed", label: t("sidebarFilterResolved") },
  ];

  return (
    <div className="w-full md:w-80 h-full bg-brand-ink border-e border-white/[0.06] flex flex-col z-10">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between shrink-0">
        <span className="text-[15px] font-semibold text-white tracking-tight">{t("sidebarInbox")}</span>
        <button
          onClick={() => setMyOnly(v => !v)}
          className={cn(
            "flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-colors",
            myOnly
              ? "bg-brand-cyan/15 text-brand-cyan"
              : "text-brand-slate hover:text-white hover:bg-white/[0.05]"
          )}
          title={t("sidebarMyChats")}
        >
          <User className="w-3.5 h-3.5" />
          {t("sidebarMyChats")}
        </button>
      </div>

      {/* New chat */}
      <div className="px-3 pb-2">
        <button
          onClick={() => setShowNewChat(true)}
          className="w-full flex items-center justify-center gap-2 bg-brand-blue text-white rounded-xl py-2 text-[13px] font-semibold hover:bg-brand-cyan transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("newChat")}
        </button>
      </div>

      {/* Search bar */}
      <div className="px-3 pb-2">
        <div className="flex items-center bg-brand-navy border border-white/[0.08] rounded-xl px-3 py-2 gap-2">
          <Search className="w-4 h-4 text-brand-slate shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t("sidebarSearchPlaceholder")}
            className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-[13px] text-white placeholder:text-brand-slate"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-white/[0.06] px-2">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={cn(
              "flex-1 py-2 text-[12px] font-medium transition-colors relative",
              filter === tab.key
                ? "text-white after:absolute after:bottom-0 after:start-0 after:end-0 after:h-[2px] after:bg-brand-cyan"
                : "text-brand-slate hover:text-white"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {visible.length === 0 ? (
          <div className="p-6 text-center text-brand-slate text-sm mt-10">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 text-brand-slate/40" />
            <p className="text-[13px]">{t("sidebarNoConversations")}</p>
          </div>
        ) : (
          visible.map(conv => (
            <ConversationItem
              key={conv.customer_phone}
              conversation={conv}
              isSelected={selectedPhone === conv.customer_phone}
              currentAgentId={agentId}
              onClick={() => onSelect(conv.customer_phone)}
            />
          ))
        )}
      </div>

      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onStarted={(phone) => onSelect(phone)}
        />
      )}
    </div>
  );
}

function ConversationItem({
  conversation,
  isSelected,
  currentAgentId,
  onClick,
}: {
  conversation: Conversation;
  isSelected: boolean;
  currentAgentId: number | null;
  onClick: () => void;
}) {
  const phone = conversation.customer_phone;
  const initials = getInitials(phone);
  const tone = avatarColor(phone);
  const timeLabel = formatConversationTime(conversation.last_message_at);
  const mine =
    conversation.assigned_agent_id != null && conversation.assigned_agent_id === currentAgentId;
  const otherAgent =
    conversation.assigned_agent_id != null && !mine ? conversation.assigned_agent_name : null;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-start flex items-center gap-3 px-3 py-3 rounded-lg transition-colors relative",
        isSelected
          ? "bg-brand-blue/15 before:absolute before:start-0 before:top-1 before:bottom-1 before:w-[2px] before:bg-brand-cyan before:rounded-full"
          : mine
            ? "bg-brand-cyan/[0.06] hover:bg-brand-cyan/[0.1] before:absolute before:start-0 before:top-1 before:bottom-1 before:w-[2px] before:bg-brand-cyan/60 before:rounded-full"
            : "hover:bg-white/[0.03]"
      )}
    >
      {/* Avatar circle */}
      <div className={cn("w-[44px] h-[44px] rounded-full flex items-center justify-center shrink-0", tone.bg)}>
        <span className={cn("text-[14px] font-semibold", tone.text)}>{initials}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[14px] font-semibold text-white truncate">
            {conversation.customer_name || phone}
          </span>
          <span className={cn(
            "text-[11px] shrink-0 ms-2",
            mine && !isSelected ? "text-brand-cyan font-medium" : "text-brand-slate"
          )}>
            {timeLabel}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-brand-slate truncate pe-2">
            {conversation.last_message || ""}
          </span>
          {otherAgent && (
            <span
              title={otherAgent}
              className="shrink-0 w-[18px] h-[18px] rounded-full bg-white/[0.08] flex items-center justify-center"
            >
              <span className="text-[9px] font-bold text-brand-slate uppercase leading-none">
                {agentInitials(otherAgent)}
              </span>
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
