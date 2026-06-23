"use client";

/**
 * "Start new chat" picker, opened from the Chats list. Lists the company's
 * contacts to pick from, or creates a new one — then kicks off the chat via
 * /api/contacts/start-chat (which sends the approved WhatsApp template, or
 * returns the "no template yet" message until one is configured).
 */

import { useEffect, useState } from "react";
import { X, Search, UserPlus, ArrowLeft } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { csrfFetch } from "@/lib/queryClient";

interface Contact {
  id: number;
  name: string | null;
  phone_number: string;
}

export default function NewChatModal({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (phone: string) => void;
}) {
  const { t: rawT } = useLanguage();
  const t = rawT as unknown as (k: string) => string;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("+966");

  useEffect(() => {
    fetch("/api/contacts", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setContacts(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const startChat = async (phone: string) => {
    setBusy(phone);
    setError("");
    try {
      const res = await csrfFetch("/api/contacts/start-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Couldn’t start the chat.");
        return;
      }
      onStarted(phone);
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const createAndStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("new");
    setError("");
    try {
      const res = await csrfFetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newName, phone_number: newPhone }),
      });
      // 409 = contact already exists; that's fine, just start the chat.
      if (!res.ok && res.status !== 409) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Couldn’t create the contact.");
        setBusy(null);
        return;
      }
      await startChat(newPhone);
    } catch {
      setError("Network error. Please try again.");
      setBusy(null);
    }
  };

  const filtered = contacts.filter(
    (c) =>
      !search.trim() ||
      c.phone_number.includes(search) ||
      (c.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-brand-navy rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col border border-white/[0.08]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            {creating && (
              <button onClick={() => { setCreating(false); setError(""); }} className="text-brand-slate hover:text-white">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-base font-semibold text-white">{t("newChat")}</h2>
          </div>
          <button onClick={onClose} className="text-brand-slate hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {creating ? (
          <form onSubmit={createAndStart} className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/90 mb-1.5">{t("contactsFormName")}</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full border border-white/[0.08] rounded-xl px-3 py-2 text-sm bg-brand-ink text-white focus:outline-none focus:border-brand-blue"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/90 mb-1.5">{t("contactsFormPhone")}</label>
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                inputMode="tel"
                className="w-full border border-white/[0.08] rounded-xl px-3 py-2 text-sm font-mono bg-brand-ink text-white focus:outline-none focus:border-brand-blue"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={busy !== null || !newPhone.trim()}
              className="w-full bg-brand-blue text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-cyan disabled:opacity-50 transition-colors"
            >
              {t("newChat")}
            </button>
          </form>
        ) : (
          <>
            <div className="p-4 pb-2">
              <div className="flex items-center bg-brand-ink border border-white/[0.08] rounded-xl px-3 py-2 gap-2">
                <Search className="w-4 h-4 text-brand-slate shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("contactsSearchPlaceholder")}
                  className="w-full bg-transparent text-sm text-white placeholder:text-brand-slate focus:outline-none"
                />
              </div>
            </div>
            {error && <p className="px-5 text-sm text-red-400">{error}</p>}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              <button
                onClick={() => { setCreating(true); setError(""); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-brand-cyan hover:bg-white/[0.03] transition-colors"
              >
                <span className="w-9 h-9 rounded-full bg-brand-cyan/15 flex items-center justify-center shrink-0">
                  <UserPlus className="w-4 h-4" />
                </span>
                <span className="text-sm font-semibold">{t("newChatCreateContact")}</span>
              </button>
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => startChat(c.phone_number)}
                  disabled={busy !== null}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/[0.03] disabled:opacity-50 transition-colors text-start"
                >
                  <span className="w-9 h-9 rounded-full bg-brand-blue/15 flex items-center justify-center shrink-0 text-[12px] font-semibold text-brand-cyan">
                    {(c.name?.trim()?.[0] ?? c.phone_number.replace(/\D/g, "").slice(-1)).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white truncate">{c.name || c.phone_number}</span>
                    {c.name && <span className="block text-xs text-brand-slate font-mono truncate">{c.phone_number}</span>}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
