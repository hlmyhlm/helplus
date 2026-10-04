"use client";

import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";
import {
  Settings as SettingsIcon,
  Bot,
  Mic,
  Phone,
  Mail,
  MessageCircle,
  Save,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsData {
  businessName: string;
  businessDesc: string;
  welcomeMessage: string;
  tone: string;
  language: string;
  aiProvider: string;
  aiModel: string;
  aiApiKey: string;
  aiBaseUrl: string;
  embedProvider: string;
  embedModel: string;
  embedApiKey: string;
  embedBaseUrl: string;
  maxTokens: number;
  temperature: number;
  elevenLabsKey: string;
  elevenLabsVoice: string;
  twilioSid: string;
  twilioToken: string;
  twilioPhone: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPass: string;
  whatsappMode: string;
  whatsappApiKey: string;
  whatsappPhone: string;
}

type SectionKey =
  | "general"
  | "ai"
  | "voice"
  | "phone"
  | "email"
  | "whatsapp";

interface TabDef {
  key: SectionKey;
  label: string;
  icon: React.ElementType;
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const tabs: TabDef[] = [
  { key: "general", label: "General", icon: SettingsIcon },
  { key: "ai", label: "AI Configuration", icon: Bot },
  { key: "voice", label: "Voice (ElevenLabs)", icon: Mic },
  { key: "phone", label: "Phone (Twilio)", icon: Phone },
  { key: "email", label: "Email (SMTP/IMAP)", icon: Mail },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
];

// Which fields belong to each section (used for partial saves)
const sectionFields: Record<SectionKey, (keyof SettingsData)[]> = {
  general: ["businessName", "businessDesc", "welcomeMessage", "tone", "language"],
  ai: [
    "aiProvider",
    "aiModel",
    "aiBaseUrl",
    "aiApiKey",
    "maxTokens",
    "temperature",
    "embedProvider",
    "embedModel",
    "embedBaseUrl",
    "embedApiKey",
  ],
  voice: ["elevenLabsKey", "elevenLabsVoice"],
  phone: ["twilioSid", "twilioToken", "twilioPhone"],
  email: [
    "smtpHost",
    "smtpPort",
    "smtpUser",
    "smtpPass",
    "smtpFrom",
    "imapHost",
    "imapPort",
    "imapUser",
    "imapPass",
  ],
  whatsapp: ["whatsappMode", "whatsappApiKey", "whatsappPhone"],
};

// ---------------------------------------------------------------------------
// Toast component
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all animate-in slide-in-from-right",
            t.type === "success"
              ? "bg-helplus-success text-white"
              : "bg-helplus-danger text-white"
          )}
        >
          {t.type === "success" ? (
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          )}
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable form components
// ---------------------------------------------------------------------------

function FormField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-helplus-text">
        {label}
      </label>
      {description && (
        <p className="text-xs text-helplus-text-light">{description}</p>
      )}
      {children}
    </div>
  );
}

const inputClasses =
  "w-full px-3 py-2 text-sm border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text placeholder:text-helplus-text-light/60 focus:outline-none focus:ring-2 focus:ring-helplus-primary/30 focus:border-helplus-primary transition-colors";

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputClasses}
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      className={inputClasses}
    />
  );
}

function TextareaInput({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={cn(inputClasses, "resize-none")}
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClasses}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(inputClasses, "pr-10")}
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-helplus-text-light hover:text-helplus-text rounded transition-colors"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function SliderInput({
  value,
  onChange,
  min,
  max,
  step,
  displayValue,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  displayValue?: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="flex-1 h-2 rounded-full appearance-none bg-helplus-border accent-helplus-primary cursor-pointer"
      />
      <span className="text-sm font-medium text-helplus-text w-16 text-right">
        {displayValue ?? value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section save button
// ---------------------------------------------------------------------------

function SaveButton({
  onClick,
  saving,
}: {
  onClick: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex justify-end pt-4 border-t border-helplus-border">
      <button
        onClick={onClick}
        disabled={saving}
        className={cn(
          "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors",
          saving
            ? "bg-helplus-primary/60 text-white cursor-not-allowed"
            : "bg-helplus-primary hover:bg-helplus-primary-dark text-white"
        )}
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function GeneralSection({
  data,
  update,
}: {
  data: SettingsData;
  update: (field: keyof SettingsData, value: string | number) => void;
}) {
  return (
    <div className="space-y-5">
      <FormField label="Business Name" description="The name of your business or organization.">
        <TextInput
          value={data.businessName}
          onChange={(v) => update("businessName", v)}
          placeholder="My Business"
        />
      </FormField>
      <FormField label="Business Description" description="A short description used for context in AI interactions.">
        <TextareaInput
          value={data.businessDesc}
          onChange={(v) => update("businessDesc", v)}
          placeholder="Describe what your business does..."
        />
      </FormField>
      <FormField label="Welcome Message" description="The greeting message sent to new customers.">
        <TextareaInput
          value={data.welcomeMessage}
          onChange={(v) => update("welcomeMessage", v)}
          placeholder="Hello! How can I help you today?"
        />
      </FormField>
      <FormField label="Tone" description="Choose the communication style for AI responses.">
        <SelectInput
          value={data.tone}
          onChange={(v) => update("tone", v)}
          options={[
            { value: "friendly", label: "Friendly" },
            { value: "professional", label: "Professional" },
            { value: "formal", label: "Formal" },
            { value: "technical", label: "Technical" },
          ]}
        />
      </FormField>
      <FormField label="Language" description="Primary language for AI responses. Auto will detect customer language.">
        <SelectInput
          value={data.language}
          onChange={(v) => update("language", v)}
          options={[
            { value: "auto", label: "Auto-detect" },
            { value: "en", label: "English" },
            { value: "tr", label: "Turkish" },
            { value: "de", label: "German" },
            { value: "fr", label: "French" },
            { value: "es", label: "Spanish" },
            { value: "pt", label: "Portuguese" },
            { value: "ar", label: "Arabic" },
            { value: "zh", label: "Chinese" },
            { value: "ja", label: "Japanese" },
          ]}
        />
      </FormField>
    </div>
  );
}

const AI_PRESETS: Record<string, { model: string; baseUrl: string }> = {
  openai: { model: "gpt-4o-mini", baseUrl: "" },
  deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com" },
  ollama: { model: "llama3.1", baseUrl: "http://localhost:11434/v1" },
  custom: { model: "", baseUrl: "" },
};

const EMBED_PRESETS: Record<string, { model: string; baseUrl: string }> = {
  openai: { model: "text-embedding-3-small", baseUrl: "" },
  ollama: { model: "nomic-embed-text", baseUrl: "http://localhost:11434/v1" },
  custom: { model: "", baseUrl: "" },
};

function AISection({
  data,
  update,
}: {
  data: SettingsData;
  update: (field: keyof SettingsData, value: string | number) => void;
}) {
  const local = (p: string) => p === "ollama" || p === "custom";

  return (
    <div className="space-y-5">
      <FormField label="AI provider" description="DeepSeek and local servers use the same OpenAI-style API.">
        <SelectInput
          value={data.aiProvider}
          onChange={(v) => {
            update("aiProvider", v);
            update("aiModel", AI_PRESETS[v]?.model ?? "");
            update("aiBaseUrl", AI_PRESETS[v]?.baseUrl ?? "");
          }}
          options={[
            { value: "openai", label: "OpenAI (ChatGPT)" },
            { value: "deepseek", label: "DeepSeek" },
            { value: "ollama", label: "Ollama (local)" },
            { value: "custom", label: "Other OpenAI-compatible server" },
          ]}
        />
      </FormField>
      <FormField label="Model" description="Exact model name, e.g. gpt-4o-mini, deepseek-chat, llama3.1.">
        <TextInput value={data.aiModel} onChange={(v) => update("aiModel", v)} placeholder="Model name" />
      </FormField>
      <FormField label="Server URL" description="Leave empty for OpenAI.">
        <TextInput value={data.aiBaseUrl} onChange={(v) => update("aiBaseUrl", v)} placeholder="https://..." />
      </FormField>
      <FormField label="API key" description={local(data.aiProvider) ? "Usually not needed for local servers." : "Your provider API key."}>
        <PasswordInput
          value={data.aiApiKey}
          onChange={(v) => update("aiApiKey", v)}
          placeholder={local(data.aiProvider) ? "Optional" : "Enter your API key"}
        />
      </FormField>
      <FormField label="Max tokens" description="Longest answer the AI may write.">
        <SliderInput
          value={data.maxTokens}
          onChange={(v) => update("maxTokens", v)}
          min={256}
          max={8192}
          step={256}
          displayValue={data.maxTokens.toLocaleString()}
        />
      </FormField>
      <FormField label="Temperature" description="Lower is more focused, higher is more creative.">
        <SliderInput
          value={data.temperature}
          onChange={(v) => update("temperature", v)}
          min={0}
          max={2}
          step={0.1}
          displayValue={data.temperature.toFixed(1)}
        />
      </FormField>

      <div className="pt-5 border-t border-helplus-border space-y-5">
        <div>
          <h4 className="text-sm font-semibold text-helplus-text">Similar-ticket search</h4>
          <p className="text-xs text-helplus-text-light mt-1">
            Needs an embeddings model. Not every provider offers one, so this can use a different provider.
          </p>
        </div>
        <FormField label="Embeddings provider">
          <SelectInput
            value={data.embedProvider}
            onChange={(v) => {
              update("embedProvider", v);
              update("embedModel", EMBED_PRESETS[v]?.model ?? "");
              update("embedBaseUrl", EMBED_PRESETS[v]?.baseUrl ?? "");
            }}
            options={[
              { value: "openai", label: "OpenAI" },
              { value: "ollama", label: "Ollama (local)" },
              { value: "custom", label: "Other OpenAI-compatible server" },
            ]}
          />
        </FormField>
        <FormField label="Embeddings model">
          <TextInput value={data.embedModel} onChange={(v) => update("embedModel", v)} placeholder="Model name" />
        </FormField>
        <FormField label="Server URL" description="Leave empty for OpenAI.">
          <TextInput value={data.embedBaseUrl} onChange={(v) => update("embedBaseUrl", v)} placeholder="https://..." />
        </FormField>
        <FormField label="API key" description="Leave empty to reuse the key above when it's the same provider.">
          <PasswordInput value={data.embedApiKey} onChange={(v) => update("embedApiKey", v)} placeholder="Optional" />
        </FormField>
      </div>
    </div>
  );
}

function VoiceSection({
  data,
  update,
}: {
  data: SettingsData;
  update: (field: keyof SettingsData, value: string | number) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="p-4 rounded-lg bg-helplus-primary-50/50 border border-helplus-primary/20">
        <p className="text-sm text-helplus-text">
          Connect your ElevenLabs account to enable AI-powered voice responses for phone calls.
        </p>
      </div>
      <FormField label="API Key" description="Your ElevenLabs API key for text-to-speech.">
        <PasswordInput
          value={data.elevenLabsKey}
          onChange={(v) => update("elevenLabsKey", v)}
          placeholder="Enter your ElevenLabs API key"
        />
      </FormField>
      <FormField label="Voice ID" description="The ElevenLabs voice ID to use for speech synthesis.">
        <TextInput
          value={data.elevenLabsVoice}
          onChange={(v) => update("elevenLabsVoice", v)}
          placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
        />
      </FormField>
    </div>
  );
}

function PhoneSection({
  data,
  update,
}: {
  data: SettingsData;
  update: (field: keyof SettingsData, value: string | number) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="p-4 rounded-lg bg-helplus-primary-50/50 border border-helplus-primary/20">
        <p className="text-sm text-helplus-text">
          Configure Twilio to enable phone call support. You will need an active Twilio account with a phone number.
        </p>
      </div>
      <FormField label="Account SID" description="Your Twilio Account SID from the dashboard.">
        <PasswordInput
          value={data.twilioSid}
          onChange={(v) => update("twilioSid", v)}
          placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        />
      </FormField>
      <FormField label="Auth Token" description="Your Twilio authentication token.">
        <PasswordInput
          value={data.twilioToken}
          onChange={(v) => update("twilioToken", v)}
          placeholder="Enter your Twilio auth token"
        />
      </FormField>
      <FormField label="Phone Number" description="Your Twilio phone number in E.164 format.">
        <TextInput
          value={data.twilioPhone}
          onChange={(v) => update("twilioPhone", v)}
          placeholder="+1234567890"
        />
      </FormField>
    </div>
  );
}

function EmailSection({
  data,
  update,
}: {
  data: SettingsData;
  update: (field: keyof SettingsData, value: string | number) => void;
}) {
  return (
    <div className="space-y-6">
      {/* SMTP */}
      <div>
        <h4 className="text-sm font-semibold text-helplus-text mb-4 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-helplus-primary" />
          Outgoing Mail (SMTP)
        </h4>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="SMTP Host">
              <TextInput
                value={data.smtpHost}
                onChange={(v) => update("smtpHost", v)}
                placeholder="smtp.gmail.com"
              />
            </FormField>
            <FormField label="SMTP Port">
              <NumberInput
                value={data.smtpPort}
                onChange={(v) => update("smtpPort", v)}
                min={1}
                max={65535}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Username">
              <TextInput
                value={data.smtpUser}
                onChange={(v) => update("smtpUser", v)}
                placeholder="your@email.com"
              />
            </FormField>
            <FormField label="Password">
              <PasswordInput
                value={data.smtpPass}
                onChange={(v) => update("smtpPass", v)}
                placeholder="Enter SMTP password"
              />
            </FormField>
          </div>
          <FormField label="From Address" description="The email address that will appear as the sender.">
            <TextInput
              value={data.smtpFrom}
              onChange={(v) => update("smtpFrom", v)}
              placeholder="support@yourbusiness.com"
            />
          </FormField>
        </div>
      </div>

      {/* IMAP */}
      <div>
        <h4 className="text-sm font-semibold text-helplus-text mb-4 flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-helplus-primary" />
          Incoming Mail (IMAP)
        </h4>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="IMAP Host">
              <TextInput
                value={data.imapHost}
                onChange={(v) => update("imapHost", v)}
                placeholder="imap.gmail.com"
              />
            </FormField>
            <FormField label="IMAP Port">
              <NumberInput
                value={data.imapPort}
                onChange={(v) => update("imapPort", v)}
                min={1}
                max={65535}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Username">
              <TextInput
                value={data.imapUser}
                onChange={(v) => update("imapUser", v)}
                placeholder="your@email.com"
              />
            </FormField>
            <FormField label="Password">
              <PasswordInput
                value={data.imapPass}
                onChange={(v) => update("imapPass", v)}
                placeholder="Enter IMAP password"
              />
            </FormField>
          </div>
        </div>
      </div>
    </div>
  );
}

function WhatsAppSection({
  data,
  update,
}: {
  data: SettingsData;
  update: (field: keyof SettingsData, value: string | number) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="p-4 rounded-lg bg-helplus-primary-50/50 border border-helplus-primary/20">
        <p className="text-sm text-helplus-text">
          Choose between WhatsApp Web (free, requires QR scan) or the official WhatsApp Business API (paid, more reliable).
        </p>
      </div>
      <FormField label="Connection Mode" description="Select how Help+ connects to WhatsApp.">
        <SelectInput
          value={data.whatsappMode}
          onChange={(v) => update("whatsappMode", v)}
          options={[
            { value: "web", label: "WhatsApp Web" },
            { value: "api", label: "WhatsApp Business API" },
          ]}
        />
      </FormField>
      {data.whatsappMode === "api" && (
        <>
          <FormField label="API Key" description="Your WhatsApp Business API key.">
            <PasswordInput
              value={data.whatsappApiKey}
              onChange={(v) => update("whatsappApiKey", v)}
              placeholder="Enter your WhatsApp API key"
            />
          </FormField>
          <FormField label="Phone Number" description="Your WhatsApp Business phone number in E.164 format.">
            <TextInput
              value={data.whatsappPhone}
              onChange={(v) => update("whatsappPhone", v)}
              placeholder="+1234567890"
            />
          </FormField>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main settings page
// ---------------------------------------------------------------------------

const defaultSettings: SettingsData = {
  businessName: "My Business",
  businessDesc: "",
  welcomeMessage: "Hello! How can I help you today?",
  tone: "friendly",
  language: "auto",
  aiProvider: "openai",
  aiModel: "gpt-4o-mini",
  aiApiKey: "",
  aiBaseUrl: "",
  embedProvider: "openai",
  embedModel: "text-embedding-3-small",
  embedApiKey: "",
  embedBaseUrl: "",
  maxTokens: 2048,
  temperature: 0.7,
  elevenLabsKey: "",
  elevenLabsVoice: "",
  twilioSid: "",
  twilioToken: "",
  twilioPhone: "",
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: "",
  imapHost: "",
  imapPort: 993,
  imapUser: "",
  imapPass: "",
  whatsappMode: "web",
  whatsappApiKey: "",
  whatsappPhone: "",
};

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<SectionKey>("general");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: "success" | "error", message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((settings) => {
        const merged = { ...defaultSettings };
        for (const key of Object.keys(merged) as (keyof SettingsData)[]) {
          if (settings[key] !== undefined && settings[key] !== null) {
            (merged as Record<string, unknown>)[key] = settings[key];
          }
        }
        setData(merged);
      })
      .catch(() => addToast("error", "Failed to load settings"))
      .finally(() => setLoading(false));
  }, [addToast]);

  const update = (field: keyof SettingsData, value: string | number) => {
    setData((prev) => ({ ...prev, [field]: value }));
  };

  const saveSection = async () => {
    setSaving(true);
    try {
      const fields = sectionFields[activeTab];
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        payload[f] = data[f];
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Save failed");
      addToast("success", "Settings saved successfully");
    } catch {
      addToast("error", "Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const sectionRenderers: Record<SectionKey, React.ReactNode> = {
    general: <GeneralSection data={data} update={update} />,
    ai: <AISection data={data} update={update} />,
    voice: <VoiceSection data={data} update={update} />,
    phone: <PhoneSection data={data} update={update} />,
    email: <EmailSection data={data} update={update} />,
    whatsapp: <WhatsAppSection data={data} update={update} />,
  };

  if (loading) {
    return (
      <>
        <Header title="Settings" description="Configure your Help+ instance" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-helplus-primary" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Settings" description="Configure your Help+ instance" />
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Tab navigation */}
          <div className="flex gap-1 p-1 bg-helplus-bg rounded-xl border border-helplus-border mb-6 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                    isActive
                      ? "bg-helplus-surface text-helplus-primary shadow-sm"
                      : "text-helplus-text-light hover:text-helplus-text hover:bg-helplus-surface/50"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Section content */}
          <div className="bg-helplus-surface rounded-xl border border-helplus-border p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-helplus-text">
                {tabs.find((t) => t.key === activeTab)?.label}
              </h3>
              <p className="text-sm text-helplus-text-light mt-0.5">
                {activeTab === "general" &&
                  "Configure your business identity and communication preferences."}
                {activeTab === "ai" &&
                  "Set up the AI model that powers your customer interactions."}
                {activeTab === "voice" &&
                  "Configure text-to-speech for voice-based support channels."}
                {activeTab === "phone" &&
                  "Connect your Twilio account for phone call handling."}
                {activeTab === "email" &&
                  "Set up email sending and receiving for support tickets."}
                {activeTab === "whatsapp" &&
                  "Configure WhatsApp integration for messaging support."}
              </p>
            </div>

            {sectionRenderers[activeTab]}

            <SaveButton onClick={saveSection} saving={saving} />
          </div>
        </div>
      </div>

      <ToastContainer toasts={toasts} />
    </>
  );
}
