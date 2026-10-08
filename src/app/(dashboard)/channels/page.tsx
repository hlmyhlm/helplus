"use client";

import { Header } from "@/components/layout/header";
import Link from "next/link";
import {
  MessageCircle,
  Mail,
  Phone,
  Save,
  Loader2,
  Power,
  Square,
  Unlink,
  ChevronRight,
  TestTube,
  PhoneCall,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/rbac";
import { useRole } from "@/lib/hooks/use-role";
import { botLabel, type Tone } from "./bot-label";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelData {
  id: string | null;
  type: string;
  isActive: boolean;
  config: Record<string, unknown>;
  status: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const isConnected = status === "connected";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
        isConnected
          ? "bg-helplus-success/10 text-helplus-success"
          : "bg-helplus-danger/10 text-helplus-danger"
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          isConnected ? "bg-helplus-success" : "bg-helplus-danger"
        )}
      />
      {isConnected ? "Connected" : "Disconnected"}
    </span>
  );
}

function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-helplus-primary/30 focus:ring-offset-2",
        enabled ? "bg-helplus-primary" : "bg-helplus-border"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
          enabled ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  isSecret = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  isSecret?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label className="block text-xs font-medium text-helplus-text-light mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          type={isSecret && !visible ? "password" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text placeholder:text-helplus-text-light/50 focus:outline-none focus:ring-2 focus:ring-helplus-primary/30 focus:border-helplus-primary transition-colors"
        />
        {isSecret && (
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-helplus-text-light hover:text-helplus-text transition-colors"
          >
            {visible ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp Card
// ---------------------------------------------------------------------------

interface BotView {
  status: string;
  stale: boolean;
  phone: string;
  error: string;
  qr: string | null;
}

const TONE_TEXT: Record<Tone, string> = {
  success: "text-helplus-success",
  danger: "text-helplus-danger",
  warning: "text-helplus-warning",
  muted: "text-helplus-text-light",
};

const TONE_DOT: Record<Tone, string> = {
  success: "bg-helplus-success",
  danger: "bg-helplus-danger",
  warning: "bg-helplus-warning",
  muted: "bg-helplus-text-light",
};

async function errorText(res: Response): Promise<string> {
  if (res.status === 403) return "You don't have permission to do that.";
  const body = await res.json().catch(() => null);
  const e = body?.error;
  return (typeof e === "string" ? e : e?.message) || "Something went wrong. Try again.";
}

function WhatsAppCard() {
  const [bot, setBot] = useState<BotView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [picks, setPicks] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [stuck, setStuck] = useState(false);
  const inFlight = useRef(false);
  const since = useRef({ status: "", at: 0 });
  // buttons follow the same permission the api checks
  const canUpdate = hasPermission(useRole(), "channels:update");

  const show = useCallback((view: BotView) => {
    const now = Date.now();
    if (view.status !== since.current.status) since.current = { status: view.status, at: now };
    setStuck((view.status === "starting" || view.status === "stopping") && now - since.current.at > 60_000);
    setBot(view);
  }, []);

  const load = useCallback(
    async (withPicks: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/channels/whatsapp");
        if (!res.ok) {
          setLoadError(await errorText(res));
          return;
        }
        show(await res.json());
        setLoadError("");
      } catch {
        setLoadError("Couldn't reach the server.");
        return;
      } finally {
        inFlight.current = false;
      }
      if (!withPicks) return;
      fetch("/api/bot/picks")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPicks(Array.isArray(d?.data) ? d.data.length : 0))
        .catch(() => {});
    },
    [show]
  );

  const status = bot?.status ?? "off";
  const changing = status === "starting" || status === "qr" || status === "stopping";

  useEffect(() => {
    load(true);
  }, [load]);

  // fast while something is changing, slow otherwise, and nothing while the tab is hidden
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "hidden") load(!changing);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load(false);
    };
    const timer = setInterval(tick, changing ? 3000 : 30000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, changing]);

  async function act(action: "connect" | "stop" | "unlink") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/channels/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setConfirmUnlink(false);
      if (res.ok) {
        show(await res.json());
      } else {
        setError(await errorText(res));
        load(false);
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const label = bot ? botLabel(bot) : null;
  const running = status === "starting" || status === "qr" || status === "connected";
  const btn =
    "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg transition-colors disabled:opacity-50";

  return (
    <div className="bg-helplus-surface rounded-xl border border-helplus-border overflow-hidden">
      <div className="px-5 py-4 border-b border-helplus-border">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-helplus-primary-50 text-helplus-link">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-helplus-text">WhatsApp bot</h3>
            <p className="text-xs text-helplus-text-light mt-0.5">
              Reads your groups and turns client messages into tickets. It never sends anything.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {loadError && !bot ? (
          <p className="text-sm text-helplus-danger">{loadError}</p>
        ) : !label ? (
          <Loader2 className="h-5 w-5 animate-spin text-helplus-text-light" />
        ) : (
          <div className="flex items-start gap-2">
            <span className={cn("mt-1.5 w-2 h-2 rounded-full flex-shrink-0", TONE_DOT[label.tone])} />
            <span className={cn("text-sm font-medium break-words", TONE_TEXT[label.tone])}>
              {label.text}
            </span>
          </div>
        )}

        {loadError && bot && <p className="text-xs text-helplus-danger">{loadError}</p>}
        {stuck && <p className="text-xs text-helplus-warning">Still waiting. Is the worker running?</p>}

        {status === "qr" && bot?.qr && (
          <div className="flex flex-col items-center gap-2">
            <div className="w-48 h-48 bg-white rounded-lg border border-helplus-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bot.qr} alt="WhatsApp QR code" className="w-full h-full object-contain" />
            </div>
            <p className="text-xs text-helplus-text-light text-center">
              WhatsApp &gt; Linked devices &gt; Link a device
            </p>
          </div>
        )}

        {error && <p className="text-xs text-helplus-danger">{error}</p>}

        {canUpdate && bot && (
          <div className="flex flex-wrap items-center gap-2">
            {confirmUnlink ? (
              <>
                <p className="w-full text-xs text-helplus-text">
                  This logs the bot out. You&apos;ll need to scan a new QR code.
                </p>
                <p className="w-full text-xs text-helplus-text-light">
                  Replies already waiting to be placed are kept.
                </p>
                <button
                  onClick={() => act("unlink")}
                  disabled={busy}
                  className={`${btn} text-white bg-helplus-danger hover:opacity-90`}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  Yes, unlink
                </button>
                <button
                  onClick={() => setConfirmUnlink(false)}
                  disabled={busy}
                  className={`${btn} text-helplus-text border border-helplus-border hover:bg-helplus-bg`}
                >
                  Cancel
                </button>
              </>
            ) : status === "off" || status === "disconnected" ? (
              <button
                onClick={() => act("connect")}
                disabled={busy}
                className={`${btn} text-white bg-helplus-primary hover:bg-helplus-primary-dark`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                Connect
              </button>
            ) : status === "stopping" ? (
              <button disabled className={`${btn} text-helplus-text border border-helplus-border`}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Stopping…
              </button>
            ) : running ? (
              <>
                <button
                  onClick={() => act("stop")}
                  disabled={busy}
                  className={`${btn} text-helplus-text border border-helplus-border hover:bg-helplus-bg`}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                  Stop
                </button>
                <button
                  onClick={() => {
                    setConfirmUnlink(true);
                    setError("");
                  }}
                  disabled={busy}
                  className={`${btn} text-helplus-danger border border-helplus-border hover:bg-helplus-bg`}
                >
                  <Unlink className="h-3.5 w-3.5" />
                  Unlink number
                </button>
              </>
            ) : null}
          </div>
        )}

        <div className="rounded-lg bg-helplus-bg p-3">
          <p className="text-xs font-semibold text-helplus-text mb-1">Before you connect</p>
          <ul className="text-xs text-helplus-text-light space-y-0.5 list-disc pl-4">
            <li>Use a separate number just for the bot.</li>
            <li>Never make the bot the only group admin.</li>
            <li>Tell each group the bot is there.</li>
          </ul>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-helplus-border bg-helplus-bg/50">
        <Link
          href="/channels/whatsapp"
          className="inline-flex items-center gap-2 text-sm font-medium text-helplus-link hover:underline"
        >
          Groups and replies
          {picks > 0 && (
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-helplus-primary-50 text-helplus-link">
              {picks}
            </span>
          )}
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Email Card
// ---------------------------------------------------------------------------

function EmailCard({
  channel,
  onSave,
  onAction,
  saving,
}: {
  channel: ChannelData;
  onSave: (type: string, config: Record<string, unknown>, isActive: boolean) => void;
  onAction: (type: string, action: string) => void;
  saving: boolean;
}) {
  const cfg = channel.config as Record<string, string>;
  const [isActive, setIsActive] = useState(channel.isActive);

  const [smtpHost, setSmtpHost] = useState(cfg.smtpHost || "");
  const [smtpPort, setSmtpPort] = useState(cfg.smtpPort || "587");
  const [smtpUser, setSmtpUser] = useState(cfg.smtpUser || "");
  const [smtpPass, setSmtpPass] = useState(cfg.smtpPass || "");
  const [smtpFrom, setSmtpFrom] = useState(cfg.smtpFrom || "");

  const [imapHost, setImapHost] = useState(cfg.imapHost || "");
  const [imapPort, setImapPort] = useState(cfg.imapPort || "993");
  const [imapUser, setImapUser] = useState(cfg.imapUser || "");
  const [imapPass, setImapPass] = useState(cfg.imapPass || "");

  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTest = async () => {
    setTestResult(null);
    onAction("email", "test");
    setTestResult("Test initiated - check server logs for results");
    setTimeout(() => setTestResult(null), 4000);
  };

  return (
    <div className="bg-helplus-surface rounded-xl border border-helplus-border overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-helplus-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-helplus-text">Email</h3>
              <p className="text-xs text-helplus-text-light mt-0.5">
                Send and receive via SMTP / IMAP
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={channel.status} />
            <Toggle enabled={isActive} onChange={setIsActive} />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-5">
        {/* SMTP */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-helplus-text-light mb-3">
            SMTP Settings (Outgoing)
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <FieldInput
              label="Host"
              value={smtpHost}
              onChange={setSmtpHost}
              placeholder="smtp.example.com"
            />
            <FieldInput
              label="Port"
              value={smtpPort}
              onChange={setSmtpPort}
              placeholder="587"
              type="text"
            />
            <FieldInput
              label="Username"
              value={smtpUser}
              onChange={setSmtpUser}
              placeholder="user@example.com"
            />
            <FieldInput
              label="Password"
              value={smtpPass}
              onChange={setSmtpPass}
              placeholder="Password"
              isSecret
            />
          </div>
          <div className="mt-3">
            <FieldInput
              label="From Address"
              value={smtpFrom}
              onChange={setSmtpFrom}
              placeholder="noreply@example.com"
            />
          </div>
        </div>

        {/* IMAP */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-helplus-text-light mb-3">
            IMAP Settings (Incoming)
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <FieldInput
              label="Host"
              value={imapHost}
              onChange={setImapHost}
              placeholder="imap.example.com"
            />
            <FieldInput
              label="Port"
              value={imapPort}
              onChange={setImapPort}
              placeholder="993"
              type="text"
            />
            <FieldInput
              label="Username"
              value={imapUser}
              onChange={setImapUser}
              placeholder="user@example.com"
            />
            <FieldInput
              label="Password"
              value={imapPass}
              onChange={setImapPass}
              placeholder="Password"
              isSecret
            />
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-blue-600" />
            <span className="text-sm text-blue-700">{testResult}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-helplus-border bg-helplus-bg/50 flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() =>
            onSave(
              "email",
              {
                smtpHost,
                smtpPort,
                smtpUser,
                smtpPass,
                smtpFrom,
                imapHost,
                imapPort,
                imapUser,
                imapPass,
              },
              isActive
            )
          }
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-helplus-primary rounded-lg hover:bg-helplus-primary-dark disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </button>
        <button
          type="button"
          onClick={handleTest}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
        >
          <TestTube className="h-4 w-4" />
          Test Connection
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phone Card
// ---------------------------------------------------------------------------

function PhoneCard({
  channel,
  onSave,
  onAction,
  saving,
}: {
  channel: ChannelData;
  onSave: (type: string, config: Record<string, unknown>, isActive: boolean) => void;
  onAction: (type: string, action: string) => void;
  saving: boolean;
}) {
  const cfg = channel.config as Record<string, string>;
  const [isActive, setIsActive] = useState(channel.isActive);

  const [twilioSid, setTwilioSid] = useState(cfg.twilioSid || "");
  const [twilioToken, setTwilioToken] = useState(cfg.twilioToken || "");
  const [twilioPhone, setTwilioPhone] = useState(cfg.twilioPhone || "");

  const [elevenLabsKey, setElevenLabsKey] = useState(cfg.elevenLabsKey || "");
  const [elevenLabsVoice, setElevenLabsVoice] = useState(
    cfg.elevenLabsVoice || ""
  );

  const voiceOptions = [
    { id: "", label: "Select a voice..." },
    { id: "rachel", label: "Rachel - Calm, professional" },
    { id: "drew", label: "Drew - Friendly, warm" },
    { id: "clyde", label: "Clyde - Authoritative" },
    { id: "domi", label: "Domi - Energetic, upbeat" },
    { id: "bella", label: "Bella - Soft, gentle" },
  ];

  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTestCall = () => {
    setTestResult(null);
    onAction("phone", "test");
    setTestResult("Test call initiated - check Twilio dashboard for status");
    setTimeout(() => setTestResult(null), 4000);
  };

  return (
    <div className="bg-helplus-surface rounded-xl border border-helplus-border overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-helplus-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-purple-50 text-purple-600">
              <Phone className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-helplus-text">Phone</h3>
              <p className="text-xs text-helplus-text-light mt-0.5">
                Voice calls via Twilio and ElevenLabs
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={channel.status} />
            <Toggle enabled={isActive} onChange={setIsActive} />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-5">
        {/* Twilio */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-helplus-text-light mb-3">
            Twilio Settings
          </h4>
          <div className="space-y-3">
            <FieldInput
              label="Account SID"
              value={twilioSid}
              onChange={setTwilioSid}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <FieldInput
              label="Auth Token"
              value={twilioToken}
              onChange={setTwilioToken}
              placeholder="Your Twilio auth token"
              isSecret
            />
            <FieldInput
              label="Phone Number"
              value={twilioPhone}
              onChange={setTwilioPhone}
              placeholder="+1234567890"
            />
          </div>
        </div>

        {/* ElevenLabs */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-helplus-text-light mb-3">
            ElevenLabs Voice
          </h4>
          <div className="space-y-3">
            <FieldInput
              label="API Key"
              value={elevenLabsKey}
              onChange={setElevenLabsKey}
              placeholder="Your ElevenLabs API key"
              isSecret
            />
            <div>
              <label className="block text-xs font-medium text-helplus-text-light mb-1">
                Voice
              </label>
              <select
                value={elevenLabsVoice}
                onChange={(e) => setElevenLabsVoice(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text focus:outline-none focus:ring-2 focus:ring-helplus-primary/30 focus:border-helplus-primary transition-colors"
              >
                {voiceOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-purple-600" />
            <span className="text-sm text-purple-700">{testResult}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-helplus-border bg-helplus-bg/50 flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() =>
            onSave(
              "phone",
              {
                twilioSid,
                twilioToken,
                twilioPhone,
                elevenLabsKey,
                elevenLabsVoice,
              },
              isActive
            )
          }
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-helplus-primary rounded-lg hover:bg-helplus-primary-dark disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </button>
        <button
          type="button"
          onClick={handleTestCall}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-purple-600 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
        >
          <PhoneCall className="h-4 w-4" />
          Test Call
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 3000);
    },
    []
  );

  const fetchChannels = useCallback(async () => {
    try {
      setFetchError(null);
      const res = await fetch("/api/channels");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setChannels(data);
    } catch {
      setFetchError("Failed to load channels. Please try refreshing the page.");
      showToast("Failed to load channels", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const handleSave = async (
    type: string,
    config: Record<string, unknown>,
    isActive: boolean
  ) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/channels/${type}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, isActive }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = await res.json();
      setChannels((prev) =>
        prev.map((ch) => (ch.type === type ? updated : ch))
      );
      showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} settings saved`);
    } catch {
      showToast("Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (type: string, action: string) => {
    try {
      const res = await fetch(`/api/channels/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Action failed");
      }
      const data = await res.json();
      if (data.type) {
        setChannels((prev) =>
          prev.map((ch) => (ch.type === type ? { ...ch, ...data } : ch))
        );
      }
      showToast(data.message || "Action completed");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Action failed",
        "error"
      );
    }
  };

  const getChannel = (type: string): ChannelData =>
    channels.find((ch) => ch.type === type) || {
      id: null,
      type,
      isActive: false,
      config: {},
      status: "disconnected",
    };

  return (
    <>
      <Header
        title="Channels"
        description="Connect and manage your communication channels"
      />

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-helplus-link" />
          </div>
        ) : fetchError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="font-medium text-helplus-text">Could not load channels</p>
            <p className="text-sm text-helplus-text-light mt-1">{fetchError}</p>
            <button
              onClick={() => { setLoading(true); fetchChannels(); }}
              className="mt-3 px-4 py-2 text-sm font-medium text-white bg-helplus-primary rounded-lg hover:bg-helplus-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl">
            <WhatsAppCard />
            <EmailCard
              channel={getChannel("email")}
              onSave={handleSave}
              onAction={handleAction}
              saving={saving}
            />
            <PhoneCard
              channel={getChannel("phone")}
              onSave={handleSave}
              onAction={handleAction}
              saving={saving}
            />
          </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all animate-in slide-in-from-bottom-4 duration-300",
            toast.type === "success"
              ? "bg-helplus-success text-white"
              : "bg-helplus-danger text-white"
          )}
        >
          {toast.type === "success" ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {toast.message}
        </div>
      )}
    </>
  );
}
