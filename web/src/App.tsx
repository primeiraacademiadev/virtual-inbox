import { IdentityControls } from "./components/identity/IdentityControls";
import {
  restorePrefs,
  savePrefs,
  localeForUi,
  type IdentityPrefs,
  type GenerationOptions,
} from "./components/identity/preferences";
import { MarkdownView } from "./components/documentation/MarkdownView";
import { ContextSidebar } from "./components/ContextSidebar";
import { ProtocolTesting } from "./components/protocols/ProtocolTesting";
import { ProtocolMetricsView } from "./components/protocols/ProtocolMetricsView";
import { eventLabel, captureReasonLabel } from "./i18n/domain";
import { localizeError } from "./i18n/errors";
import { useI18n } from "./i18n/context";
import { LanguageSelector } from "./i18n/LanguageSelector";
import { CopyButton } from "./components/clipboard/CopyButton";
import { CopyMenu } from "./components/clipboard/CopyMenu";
import { useDismissable } from "./hooks/useDismissable";
import { generateDemoSample, applyDemoSample, beginDemoCompose, refreshDemoOnLocaleChange } from "./demo-samples";
import { removeInboxAndReconcile } from "./inbox-removal";
import { DocumentSearch, type SearchDestination } from "./search/DocumentSearch";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  classify,
  del,
  post,
  request,
  type Channel,
  type EventEntry,
  type Message,
  type Observer,
  type Recipient,
} from "./api";
type View = "split" | "inbox" | "logs";
type Page = "workspace" | "connections" | "smtp" | "pop3" | "simulations" | "documentation" | "api";
type Client = { id: string; remoteAddress: string; authUser?: string; activeSessions: number; totalSessions: number; authenticatedSessions: number };
type SmtpSession = { id: string; clientId: string; remoteAddress: string; connectedAt: string; disconnectedAt?: string; connected: boolean; secure: boolean; authenticated: boolean; authUser?: string; authAttempts: Array<{ id: string; at: string; method: string; authUser: string; accepted: boolean }>; messageIds: string[]; errors: Array<{ at: string; responseCode: number; code: string }> };
async function postDemo(path: string, data: unknown) {
  const response = await fetch("/demo" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok)
    throw Object.assign(new Error("Demo send failed: " + response.status), {
      errorCode: "DEMO_SEND_FAILED",
    });
  return response.json();
}
const base = (c: Channel) => (c === "email" ? "/mailboxes" : "/phone-numbers");
const safeDoc = (value: string) => (/^[a-z0-9-]+$/.test(value) ? value : "overview");
const safeLocale = (value: string) => (["pt-PT", "en", "fr"].includes(value) ? value : "en");
const safeObserver = (value: string) =>
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value) ? value : "";
export default function App() {
  const { locale, t, formatDate, formatNumber } = useI18n();
  const [page, setPage] = useState<Page>("workspace");
  const [identityPrefs, setIdentityPrefs] = useState<IdentityPrefs>(() => restorePrefs(locale));
  const [identityOptions, setIdentityOptions] = useState<GenerationOptions | null>(null);
  const hadSavedIdentityPrefs = useRef(
    (() => {
      try {
        return !!sessionStorage.getItem("virtual-inbox-generation");
      } catch {
        return false;
      }
    })(),
  );
  const identityPrefsTouched = useRef(false);
  const changeIdentityPrefs = (value: IdentityPrefs) => {
    identityPrefsTouched.current = true;
    setIdentityPrefs(value);
  };
  const previousUiLocale = useRef(locale);
  useEffect(() => {
    if (previousUiLocale.current !== locale) {
      previousUiLocale.current = locale;
      setIdentityPrefs((p) => ({ ...p, locale: localeForUi(locale) }));
    }
  }, [locale]);
  useEffect(() => savePrefs(identityPrefs), [identityPrefs]);
  useEffect(() => {
    void request<{
      active: {
        source: string;
        subject: string;
        subjectAltName: string;
        validTo: string;
        fingerprint256: string;
      } | null;
    }>("/tls/status")
      .then((x) => {
        setActiveCertificate(x.active);
        if (x.active?.subjectAltName) {
          const names = [...x.active.subjectAltName.matchAll(/(?:DNS|IP Address):([^,]+)/g)].map(
            (m) => m[1].trim(),
          );
          if (names.length) setTlsNames(names.join(","));
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    void request<GenerationOptions>("/identity-generation/options")
      .then((x) => {
        setIdentityOptions(x);
        if (!hadSavedIdentityPrefs.current && !identityPrefsTouched.current)
          setIdentityPrefs((p) => ({
            ...p,
            emailStrategy: x.defaults.emailStrategy,
            phoneStrategy: x.defaults.phoneStrategy,
            safeTestData: x.defaults.safeTestData,
            includeCountryCode: x.defaults.includeCountryCode,
          }));
      })
      .catch(() => {});
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationRef = useDismissable<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const [connection, setConnection] = useState<any>(null);
  const [adminToken, setAdminToken] = useState("");
  const [smtpClients, setSmtpClients] = useState<Client[]>([]);
  const [smtpHistory, setSmtpHistory] = useState<SmtpSession[]>([]);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [testGuid, setTestGuid] = useState("");
  const [testResult, setTestResult] = useState("");
  const [smtpSelectedSession, setSmtpSelectedSession] = useState("");
  const [smtpResult, setSmtpResult] = useState("");
  const [smtpError, setSmtpError] = useState("");
  const [tlsCertFile, setTlsCertFile] = useState<File | null>(null);
  const [tlsKeyFile, setTlsKeyFile] = useState<File | null>(null);
  const [tlsStatus, setTlsStatus] = useState("");
  const [activeCertificate, setActiveCertificate] = useState<{
    source: string;
    subject: string;
    subjectAltName: string;
    validTo: string;
    fingerprint256: string;
  } | null>(null);
  const [tlsNames, setTlsNames] = useState("localhost,127.0.0.1");
  const [tlsNamesStatus, setTlsNamesStatus] = useState("");
  const [networkFields, setNetworkFields] = useState<Record<string, string>>({});
  const [networkStatus, setNetworkStatus] = useState("");
  const [docText, setDocText] = useState("");
  const [docPage, setDocPage] = useState("overview");
  const [jump, setJump] = useState<SearchDestination | null>(null);
  const [apiText, setApiText] = useState("");
  const [observer, setObserver] = useState(
    () => sessionStorage.getItem("virtual-inbox-observer") || "",
  );
  const [inboxes, setInboxes] = useState<Recipient[]>([]);
  const inboxesRef = useRef<Recipient[]>([]);
  useEffect(() => {
    inboxesRef.current = inboxes;
  }, [inboxes]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("split");
  const [collapsed, setCollapsed] = useState(false);
  const [groups, setGroups] = useState({ email: true, sms: true });
  const [modal, setModal] = useState<Channel | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [ttlOpen, setTtlOpen] = useState(false);
  const [ttl, setTtl] = useState("1800");
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [compose, setCompose] = useState(false);
  const [sender, setSender] = useState("demo@example.test");
  const initialDemoSample = useRef(generateDemoSample(locale));
  const [subject, setSubject] = useState(initialDemoSample.current.subject);
  const [body, setBody] = useState(initialDemoSample.current.body);
  useEffect(() => {
    refreshDemoOnLocaleChange(locale, compose, { setSubject, setBody });
  }, [locale]);
  const [outgoingFiles, setOutgoingFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [seen, setSeen] = useState<Record<string, string[]>>({});
  const [detail, setDetail] = useState<Message | null>(null);
  const [logs, setLogs] = useState<EventEntry[]>([]);
  const [logFilter, setLogFilter] = useState("");
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    void request<any>("/connection-info")
      .then((data) => {
        setConnection(data);
        setNetworkFields(data.networkSettings || {});
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setApiText("");
    fetch("/wiki/" + safeLocale(locale) + "/api.md", { signal: controller.signal })
      .then((r) => (r.ok ? r.text() : t("unavailable")))
      .then((text) => {
        if (!controller.signal.aborted) setApiText(text);
      })
      .catch(() => {
        if (!controller.signal.aborted) setApiText(t("unavailable"));
      });
    return () => controller.abort();
  }, [locale, t]);
  useEffect(() => {
    const controller = new AbortController();
    setDocText("");
    fetch("/wiki/" + safeLocale(locale) + "/" + safeDoc(docPage) + ".md", {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.text() : t("unavailable")))
      .then((text) => {
        if (!controller.signal.aborted) setDocText(text);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDocText(t("unavailable"));
      });
    return () => controller.abort();
  }, [docPage, locale, t]);
  useEffect(() => {
    if (!jump || (page !== "documentation" && page !== "api")) return;
    const timeout = setTimeout(() => {
      const root = document.querySelector(".information .docMarkdown");
      const heading = root?.querySelectorAll("h1,h2,h3")[Math.max(0, jump.ordinal - 1)] as
        HTMLElement | undefined;
      heading?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (heading) {
        heading.classList.add("searchTarget");
        setTimeout(() => heading.classList.remove("searchTarget"), 1600);
      }
      setJump(null);
    }, 130);
    return () => clearTimeout(timeout);
  }, [jump, docText, apiText, page]);
  function openPage(next: Page) {
    setPage(next);
    setMenuOpen(false);
  }
  function openDocument(id: string) {
    if (id === "api") {
      openPage("api");
    } else {
      setDocPage(id);
      openPage("documentation");
    }
  }
  function navigateSearch(target: SearchDestination) {
    setJump(target);
    if (target.document === "api") setPage("api");
    else {
      setDocPage(target.document);
      setPage("documentation");
    }
  }
  const active = inboxes.find((x) => x.id === selected) || null;
  const refresh = useCallback(async (id: string, c: Channel) => {
    try {
      const m = await request<Message[]>(base(c) + "/" + id + "/messages");
      setMessages((p) => ({ ...p, [id]: m }));
    } catch {}
  }, []);
  const syncObserver = useCallback(
    async (id: string) => {
      const snapshot = await request<Observer>("/observers/" + id);
      setInboxes(snapshot.inboxes);
      for (const r of snapshot.inboxes) void refresh(r.id, r.channel);
    },
    [refresh],
  );
  useEffect(() => {
    let activeSse: EventSource | null = null;
    let closed = false;
    const path = safeObserver(observer)
      ? "/api/observers/" + safeObserver(observer) + "/events"
      : "/api/observers/events";
    activeSse = new EventSource(path);
    setConnected(false);
    const handleSession = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as Observer;
      if (closed) return;
      setObserver(data.observerId);
      sessionStorage.setItem("virtual-inbox-observer", data.observerId);
      setInboxes(data.inboxes);
      data.inboxes.forEach((r) => void refresh(r.id, r.channel));
    };
    const handleLog = (ev: MessageEvent) => {
      const entry = JSON.parse(ev.data) as EventEntry;
      setLogs((p) => (p.some((x) => x.id === entry.id) ? p : [...p.slice(-499), entry]));
      if (entry.resourceId && entry.type.startsWith("message.")) {
        const r = inboxesRef.current.find((x) => x.id === entry.resourceId);
        if (r) void refresh(r.id, r.channel);
      }
    };
    activeSse.addEventListener("session.initialized", handleSession);
    activeSse.addEventListener("session.restored", handleSession);
    activeSse.addEventListener("log", handleLog);
    activeSse.addEventListener("inbox.notification", handleLog);
    activeSse.addEventListener("log.gap", () => {
      if (observer) void syncObserver(observer);
    });
    activeSse.addEventListener("log.reset", () => {
      setLogs([]);
      if (observer) void syncObserver(observer);
    });
    activeSse.onopen = () => setConnected(true);
    activeSse.onerror = () => {
      setConnected(false);
      if (observer) {
        void request<Observer>("/observers/" + observer).catch((e: Error & { status?: number }) => {
          if (e.status === 404) {
            sessionStorage.removeItem("virtual-inbox-observer");
            setObserver("");
            setInboxes([]);
          }
        });
      }
    };
    return () => {
      closed = true;
      activeSse?.close();
    };
  }, [observer, refresh, syncObserver]);
  useEffect(() => {
    if (!observer) return;
    const poll = setInterval(() => {
      void syncObserver(observer);
    }, 15000);
    return () => clearInterval(poll);
  }, [observer, syncObserver]);
  const unread = useCallback(
    (id: string) => (messages[id] || []).filter((m) => !(seen[id] || []).includes(m.id)).length,
    [messages, seen],
  );
  const focus = (id: string) => {
    setSelected(id);
    setView((v) => (v === "inbox" && id === selected ? "split" : "inbox"));
    setCompose(false);
    setDetail(null);
  };
  async function addExisting() {
    if (!observer) return;
    const type = classify(identifier.trim());
    if (!type) {
      setError(t("invalidFormat"));
      return;
    }
    try {
      const all = await request<Recipient[]>(
        base(type) + "?address=" + encodeURIComponent(identifier.trim()),
      );
      const r = all[0];
      if (!r) {
        setMissing(true);
        return;
      }
      await post("/observers/" + observer + "/inboxes", { inboxId: r.id });
      await syncObserver(observer);
      focus(r.id);
      setModal(null);
    } catch (e) {
      setError(localizeError(e, locale));
    }
  }
  async function create() {
    if (!observer || !modal) return;
    const c = identifier.trim() ? classify(identifier.trim()) : modal;
    if (!c) return;
    try {
      const r = await post<Recipient>(base(c), {
        ...(identifier.trim()
          ? { [c === "email" ? "address" : "phoneNumber"]: identifier.trim() }
          : {
              generation: {
                locale: identityPrefs.locale,
                strategy: c === "email" ? identityPrefs.emailStrategy : identityPrefs.phoneStrategy,
                safeTestData: identityPrefs.safeTestData,
                ...(c === "sms" ? { includeCountryCode: identityPrefs.includeCountryCode } : {}),
              },
            }),
        ttlSeconds: Number(ttl),
        observerId: observer,
      });
      await syncObserver(observer);
      setSelected(r.id);
      setView("inbox");
      setModal(null);
      setMissing(false);
      setIdentifier("");
      setCompose(false);
    } catch (e) {
      setError(localizeError(e, locale));
    }
  }
  function newDemoSample() {
    applyDemoSample(locale, subject, { setSubject, setBody });
  }
  function startCompose() {
    beginDemoCompose(locale, subject, {
      setSubject, setBody,
      clearAttachments: () => setOutgoingFiles([]),
      showComposer: () => setCompose(true),
    });
  }
  async function send() {
    if (!active) return;
    try {
      if (active.channel === "sms")
        await postDemo("/sms/messages", { from: sender, to: active.address, body });
      else {
        const attachments = await Promise.all(
          outgoingFiles.map(async (file) => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = "";
            for (const v of bytes) binary += String.fromCharCode(v);
            return {
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              contentBase64: btoa(binary),
            };
          }),
        );
        await postDemo("/mailboxes/" + active.id + "/demo-send", {
          from: sender,
          subject,
          body,
          attachments,
        });
      }
      await refresh(active.id, active.channel);
      setOutgoingFiles([]);
      setCompose(false);
    } catch (e) {
      setError(
        (e as { errorCode?: string })?.errorCode === "DEMO_SEND_FAILED"
          ? t("demoSendFailed")
          : localizeError(e, locale),
      );
    }
  }
  async function deleteMessage(m: Message) {
    if (!active) return;
    try {
      await del(base(active.channel) + "/" + active.id + "/messages/" + m.id);
      setDetail(null);
      await refresh(active.id, active.channel);
    } catch (e) {
      setError(localizeError(e, locale));
    }
  }
  async function removeInbox(target: Recipient) {
    if (!observer) return;
    try {
      await removeInboxAndReconcile(target, observer, selected, {
        confirmDelete: () => window.confirm(t("confirmDelete")),
        remove: del,
        syncObserver,
        clearSelected: () => {
          setSelected(null);
          setView("logs");
          setCompose(false);
          setDetail(null);
        },
      });
    } catch (e) {
      setError(localizeError(e, locale));
    }
  }
  async function saveNetwork() {
    try {
      const endpoint = "/api/admin/network";
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + adminToken },
        body: JSON.stringify(networkFields),
      });
      if (!response.ok) throw Error(t("configurationRejected") + ": HTTP " + response.status);
      setNetworkStatus(t("networkSaved"));
    } catch (e) {
      setNetworkStatus(localizeError(e, locale));
    }
  }
  async function saveTlsNames() {
    const values = tlsNames
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    try {
      const dns = values.filter((x) => !(/^[0-9.]+$/.test(x) || x.includes(":")));
      const ips = values.filter((x) => !dns.includes(x));
      const endpoint = "/api/admin/tls/names";
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + adminToken },
        body: JSON.stringify({ dns, ips }),
      });
      if (!response.ok) throw Error("TLS SAN update: HTTP " + response.status);
      const updated = await response.json();
      setActiveCertificate(updated.active);
      setTlsNamesStatus(t("tlsApplied"));
    } catch (error) {
      setTlsNamesStatus(localizeError(error, locale));
    }
  }
  async function importCertificate() {
    if (!tlsCertFile || !tlsKeyFile) {
      setTlsStatus(t("selectPem"));
      return;
    }
    try {
      const endpoint = "/api/admin/tls";
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + adminToken },
        body: JSON.stringify({ cert: await tlsCertFile.text(), key: await tlsKeyFile.text() }),
      });
      if (!response.ok) throw new Error(t("importRejected") + ": HTTP " + response.status);
      const result = await response.json();
      setActiveCertificate(result.active);
      setTlsStatus(t("certificateInstalled") + " " + (result.active?.subject || ""));
      setAdminToken("");
      setTlsCertFile(null);
      setTlsKeyFile(null);
    } catch (e) {
      setTlsStatus(localizeError(e, locale));
    }
  }
  const smtpAdminHeaders = () => ({ Authorization: "Bearer " + adminToken });
  const reloadSmtp = useCallback(async () => {
    if (!adminToken || location.protocol !== "https:") return;
    try {
      const response = await Promise.all([
        request<Client[]>("/admin/smtp/clients", { headers: smtpAdminHeaders() }),
        request<SmtpSession[]>("/admin/smtp/sessions", { headers: smtpAdminHeaders() }),
      ]);
      setSmtpClients(response[0]); setSmtpHistory(response[1]); setSmtpError("");
    } catch (error) { setSmtpError(error instanceof Error ? error.message : "Unable to read SMTP sessions"); }
  }, [adminToken]);
  useEffect(() => {
    if (page !== "smtp" || !adminToken) return;
    void reloadSmtp();
    const interval = setInterval(() => { void reloadSmtp(); }, 5000);
    return () => clearInterval(interval);
  }, [page, adminToken, reloadSmtp]);
  async function verifyTestGuid() {
    if (!testGuid || !adminToken) return;
    try {
      const value = await request<{ matches: boolean }>("/admin/test/sessions/" + encodeURIComponent(testGuid) + "/verify", {
        method: "POST", headers: smtpAdminHeaders(), body: JSON.stringify({ username: smtpUser, password: smtpPassword }),
      });
      setTestResult(value.matches ? "Credentials match" : "Credentials do not match");
    } catch (error) { setTestResult(error instanceof Error ? error.message : "Verification failed"); }
    finally { setSmtpPassword(""); }
  }
  async function verifySmtp() {
    if (!smtpSelectedSession || !adminToken) return;
    setSmtpResult("");
    try {
      const value = await request<{ usernameMatches: boolean; passwordMatches: boolean; matches: boolean }>(
        "/admin/smtp/sessions/" + smtpSelectedSession + "/verify", {
          method: "POST", headers: smtpAdminHeaders(),
          body: JSON.stringify({ username: smtpUser, password: smtpPassword }),
        });
      setSmtpResult("User: " + (value.usernameMatches ? "match" : "mismatch") +
        " · Password: " + (value.passwordMatches ? "match" : "mismatch"));
    } catch (error) { setSmtpResult(error instanceof Error ? error.message : "Verification failed"); }
    finally { setSmtpPassword(""); }
  }
  const filteredLogs = useMemo(
    () => logs.filter((x) => JSON.stringify(x).toLowerCase().includes(logFilter.toLowerCase())),
    [logs, logFilter],
  );
  return (
    <div className="shell">
      <header>
        <div className="appNavigation" ref={navigationRef}>
          <button
            aria-label={t("toggleMenu")}
            aria-expanded={menuOpen}
            aria-controls="primary-nav-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>
          {menuOpen && (
            <nav id="primary-nav-menu" className="hamburgerMenu" aria-label={t("documentation")}>
              <button onClick={() => openPage("workspace")}>{t("inboxes")}</button>
              <button onClick={() => openPage("smtp")}>Protocols</button>
              <button onClick={() => openPage("documentation")}>{t("documentation")}</button>
              <button onClick={() => openPage("connections")}>System</button>
            </nav>
          )}
        </div>
        <strong>✉ Virtual Inbox</strong>
        <div className="spacer" />
        <span className="tiny">{connected ? t("connected") : t("disconnected")}</span>
        <LanguageSelector />
        <span className="tiny">
          {t("session")} {observer.slice(0, 8) || t("connecting")}
        </span>
        <CopyButton value={observer} label={t("copySession")} />
      </header>
      {page !== "workspace" && <ContextSidebar page={page} docPage={docPage} docText={docText} onPage={openPage} onDocument={openDocument} />}
      {page === "workspace" && (
        <div className="workspace">
          <aside className={"sidebar" + (collapsed ? " closed" : "")}>
            <div className="sidebarControls">
              <button
                type="button"
                className="sidebarToggle"
                title={t("toggleMenu")}
                aria-label={t("toggleMenu")}
                aria-expanded={!collapsed}
                onClick={() => setCollapsed((v) => !v)}
              >
                {collapsed ? "»" : "«"}
                {!collapsed && <span>{t("toggleMenu")}</span>}
              </button>
            </div>
            {(["email", "sms"] as Channel[]).map((c) => (
              <section key={c} className="inboxGroup">
                <div className="groupHead">
                  <div className="navWithTools">
                    <button
                      className="ghost groupToggle"
                      onClick={() => setGroups((p) => ({ ...p, [c]: !p[c] }))}
                      aria-label={t("inboxGroup") + " — " + t(c === "email" ? "email" : "sms")}
                    >
                      {c === "email" ? "✉" : "▣"}{" "}
                      {!collapsed && t("inboxGroup") + " — " + t(c === "email" ? "email" : "sms")}{" "}
                      {!collapsed && (groups[c] ? "⌄" : "›")}
                    </button>
                    {collapsed && (
                      <div className="hoverTools" role="group">
                        <span>{t("inboxGroup") + " — " + t(c === "email" ? "email" : "sms")}</span>
                        <button
                          onClick={() => {
                            setModal(c);
                            setIdentifier("");
                            setMissing(false);
                            setError("");
                          }}
                        >
                          + {t("addInbox")}
                        </button>
                      </div>
                    )}
                  </div>
                  {!collapsed && (
                    <button
                      aria-label={t("addInbox") + " " + t(c === "email" ? "email" : "sms")}
                      title={t("addInbox")}
                      onClick={() => {
                        setModal(c);
                        setIdentifier("");
                        setMissing(false);
                        setError("");
                      }}
                    >
                      +
                    </button>
                  )}
                </div>
                {groups[c] &&
                  inboxes
                    .filter((r) => r.channel === c)
                    .map((r) => (
                      <div key={r.id} className="navWithTools sidebarInboxRow">
                        <button
                          className={
                            "navItem" + (selected === r.id && view !== "logs" ? " active" : "")
                          }
                          onClick={() => focus(r.id)}
                          title={collapsed ? undefined : r.address}
                          aria-label={r.address}
                        >
                          {!collapsed && (
                            <span className="name">
                              {r.system ? "⚠ " : ""}
                              {r.address}
                            </span>
                          )}
                          {collapsed && <span>{c === "email" ? "✉" : "▣"}</span>}
                          {unread(r.id) > 0 && <span className="badge">{unread(r.id)}</span>}
                        </button>
                        {!collapsed && (
                          <button
                            type="button"
                            className="sidebarRemoveInbox"
                            title={t("removeInbox")}
                            aria-label={t("removeInbox") + ": " + r.address}
                            onClick={() => void removeInbox(r)}
                          >
                            ×
                          </button>
                        )}
                        {collapsed && (
                          <div className="hoverTools" role="group">
                            <strong>{r.address}</strong>
                            <button onClick={() => focus(r.id)}>{t("selectInbox")}</button>
                            <CopyMenu
                              label={t("copyData")}
                              items={[
                                { label: t("copyAddress"), value: r.address },
                                { label: t("copyId"), value: r.id },
                                {
                                  label: t("copyEndpoint"),
                                  value:
                                    location.origin +
                                    "/api" +
                                    base(r.channel) +
                                    "/" +
                                    r.id +
                                    "/messages",
                                },
                              ]}
                            />
                            <button
                              onClick={() => {
                                setSelected(r.id);
                                setView("inbox");
                                startCompose();
                              }}
                            >
                              {t("sendMessage")}
                            </button>
                            <button onClick={() => void removeInbox(r)}>{t("removeInbox")}</button>
                          </div>
                        )}
                      </div>
                    ))}
              </section>
            ))}
            <div className="spacer" />
            <button
              className={"navItem" + (view === "logs" ? " active" : "")}
              onClick={() => setView((v) => (v === "logs" ? "split" : "logs"))}
            >
              ☷ {!collapsed && t("logs")}
            </button>
          </aside>
          <main
            className={
              "main " + (view === "split" ? "split" : view === "logs" ? "logsOnly" : "inboxOnly")
            }
          >
            {view !== "logs" && (
              <section className="panel">
                <div className="panelHead">
                  <div>
                    <div className="panelTitle">{active?.address || t("selectInbox")}</div>
                    {active && (
                      <div className="tiny">
                        {active.system
                          ? t("anomalies")
                          : t("expires") + " " + formatDate(active.expiresAt!)}
                      </div>
                    )}
                  </div>
                  <div className="spacer" />
                  {active && (
                    <>
                      <CopyMenu
                        label={t("copyData")}
                        items={[
                          { label: "Endereço", value: active.address },
                          { label: "UUID da inbox", value: active.id },
                          {
                            label: "Endpoint de mensagens",
                            value:
                              location.origin +
                              "/api" +
                              base(active.channel) +
                              "/" +
                              active.id +
                              "/messages",
                          },
                        ]}
                      />
                      <button title={t("removeInbox")} onClick={() => void removeInbox(active)}>
                        ×
                      </button>
                    </>
                  )}
                  <button title={t("minimizeInbox")} onClick={() => setView("logs")}>
                    ▾
                  </button>
                </div>
                {active && compose && (
                  <div className="composeOverlay">
                    <div className="compose">
                      <div className="composeHeading">
                        <strong>{t("sendTo")} {active.address}</strong>
                        <button type="button" onClick={newDemoSample}>{t("newSample")}</button>
                      </div>
                      <label>
                        {t("sender")}
                        <input value={sender} onChange={(e) => setSender(e.target.value)} />
                      </label>
                      {active.channel === "email" && (
                        <label>
                          {t("subject")}
                          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
                        </label>
                      )}
                      <label>
                        {t("message")}
                        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
                      </label>
                      {active.channel === "email" && (
                        <label>
                          {t("attachments")}
                          <input
                            type="file"
                            multiple
                            onChange={(e) => setOutgoingFiles(Array.from(e.target.files || []))}
                          />
                        </label>
                      )}
                      <div className="actions">
                        <button onClick={() => setCompose(false)}>{t("cancel")}</button>
                        <button onClick={() => void send()}>{t("send")}</button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="panelBody inboxScroll">
                  {active && (
                    <div className="messages">
                      {(messages[active.id] || [])
                        .slice()
                        .reverse()
                        .map((m) => (
                          <button
                            key={m.id}
                            className={
                              "msg" + (!(seen[active.id] || []).includes(m.id) ? " unread" : "")
                            }
                            onClick={() => {
                              setDetail(m);
                              setSeen((p) => ({
                                ...p,
                                [active.id]: [...new Set([...(p[active.id] || []), m.id])],
                              }));
                            }}
                          >
                            <div className="msgTitle">
                              {m.subject || m.body.slice(0, 65) || t("emptyBody")}{" "}
                              <span className="tiny">{formatDate(m.receivedAt)}</span>
                            </div>
                            <div className="tiny">
                              {m.from}
                              {m.captureReason
                                ? " · " + captureReasonLabel(locale, m.captureReason)
                                : ""}
                            </div>
                          </button>
                        ))}
                      {detail && detail.destinationId === active.id && (
                        <div className="detail">
                          <div className="actions">
                            <button onClick={() => void deleteMessage(detail)}>
                              {t("deleteMessage")}
                            </button>
                            <button onClick={() => setDetail(null)}>{t("close")}</button>
                          </div>
                          <p>
                            <b>{t("from")}</b> {detail.from}
                          </p>
                          <p>
                            <b>{t("to")}</b> {detail.originalRecipient}
                          </p>
                          <p>
                            <b>{t("subject")}</b> {detail.subject || "—"}
                          </p>
                          <div className="copyDetails">
                            <CopyButton value={detail.id} label={t("copyMessageId")} />
                            <CopyButton value={detail.from} label={t("copySender")} />
                            <CopyButton
                              value={detail.originalRecipient}
                              label={t("copyRecipient")}
                            />
                          </div>
                          <div>{detail.body}</div>
                          {!!detail.attachments?.length && (
                            <section>
                              <h4>
                                {t("attachments")} ({detail.attachments.length})
                              </h4>
                              {detail.attachments.map((a) => (
                                <p key={a.id}>
                                  <a
                                    href={
                                      "/api" +
                                      base(active.channel) +
                                      "/" +
                                      active.id +
                                      "/messages/" +
                                      detail.id +
                                      "/attachments/" +
                                      a.id
                                    }
                                    download={a.filename}
                                  >
                                    {a.filename}
                                  </a>{" "}
                                  · {a.contentType} ·{" "}
                                  {formatNumber(Math.round(a.size / 102.4) / 10)} KiB
                                </p>
                              ))}
                            </section>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {active && !compose && (
                  <button
                    className="fab"
                    aria-label={t("sendMessage")}
                    title={t("sendMessage")}
                    onClick={startCompose}
                  >
                    {compose ? "×" : "+"}
                  </button>
                )}
              </section>
            )}
            {view !== "inbox" && (
              <section className="panel">
                <div className="panelHead">
                  <strong>{t("logs")}</strong>
                  <div className="spacer" />
                  <button onClick={() => setView("inbox")} title={t("minimizeLogs")}>
                    ▾
                  </button>
                </div>
                <div className="logFilters">
                  <input
                    aria-label={t("filterLogs")}
                    placeholder={t("filterLogs")}
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                  />
                  <button onClick={() => setLogs([])}>{t("clearView")}</button>
                </div>
                <div className="panelBody">
                  {filteredLogs
                    .slice()
                    .reverse()
                    .map((e) => (
                      <div className="logRow" key={e.id}>
                        <span>{formatDate(e.at)}</span>
                        {eventLabel(locale, e.type)} <span>{e.resourceId?.slice(0, 8) || ""}</span>
                      </div>
                    ))}
                </div>
              </section>
            )}
          </main>
        </div>
      )}
      {page === "smtp" && (
        <main className="information">
          <h2>SMTP clients and sessions</h2>
          <ProtocolMetricsView adminToken={adminToken} />
          <p className="muted">Only accessible via HTTPS with ADMIN_TOKEN. SMTP authentication accepts test credentials; this view compares them with credentials observed previously.</p>
          <label>Administrator token
            <input type="password" autoComplete="off" value={adminToken} onChange={e => setAdminToken(e.target.value)} />
          </label>
          <div className="actions"><button onClick={() => void reloadSmtp()} disabled={!adminToken || location.protocol !== "https:"}>Refresh</button></div>
          {location.protocol !== "https:" && <p role="alert">HTTPS is required.</p>}
          {smtpError && <p role="alert">{smtpError}</p>}
          <h3>Observed clients ({smtpClients.length})</h3>
          <table><thead><tr><th>Client / user</th><th>Remote address</th><th>Active</th><th>Sessions</th></tr></thead>
          <tbody>{smtpClients.map(client => <tr key={client.id}><td>{client.authUser || "Anonymous"}<div className="tiny">{client.id}</div></td><td>{client.remoteAddress}</td><td>{client.activeSessions}</td><td>{client.totalSessions}</td></tr>)}</tbody></table>
          <h3>SMTP sessions ({smtpHistory.length})</h3>
          {smtpHistory.map(session => <section className="detail" key={session.id}>
            <strong>{session.authUser || "Anonymous"} · {session.connected ? "Connected" : "Disconnected"}</strong>
            <p className="tiny">{session.id} · {session.remoteAddress} · {formatDate(session.connectedAt)} · TLS: {session.secure ? "yes" : "no"}</p>
            <p>Authenticated: {session.authenticated ? "yes" : "no"} · Messages: {session.messageIds.length} · Errors: {session.errors.length}</p>
            {session.authAttempts.map(attempt => <p key={attempt.id} className="tiny">AUTH {attempt.method}: {attempt.authUser} · {formatDate(attempt.at)} · {attempt.accepted ? "accepted" : "rejected"}</p>)}
            {session.errors.map((error, index) => <p key={index} className="tiny">SMTP {error.responseCode}: {error.code}</p>)}
            {!!session.authAttempts.length && <button type="button" onClick={() => { setSmtpSelectedSession(session.id); setSmtpUser(session.authUser || ""); setSmtpResult(""); }}>Validate credentials</button>}
          </section>)}
          <section className="detail">
            <h3>Verify SMTP / POP3 logical test session</h3>
            <p className="tiny">Both protocols share the same inbox, password and GUID identity.</p>
            <label>Session GUID<input value={testGuid} onChange={e => setTestGuid(e.target.value)} /></label>
            <label>Inbox / username<input value={smtpUser} onChange={e => setSmtpUser(e.target.value)} /></label>
            <label>Password<input type="password" value={smtpPassword} onChange={e => setSmtpPassword(e.target.value)} autoComplete="off" /></label>
            <button onClick={() => void verifyTestGuid()} disabled={!adminToken || !testGuid}>Verify shared credentials</button>
            {testResult && <p role="status">{testResult}</p>}
          </section>
          {smtpSelectedSession && <section className="detail">
            <h3>Validate recorded credentials</h3><p className="tiny">Session {smtpSelectedSession}. Compares against the most recent authentication attempt.</p>
            <label>Username<input value={smtpUser} onChange={e => setSmtpUser(e.target.value)} autoComplete="off" /></label>
            <label>Password<input type="password" value={smtpPassword} onChange={e => setSmtpPassword(e.target.value)} autoComplete="off" /></label>
            <div className="actions"><button onClick={() => void verifySmtp()}>Validate</button><button onClick={() => setSmtpSelectedSession("")}>Close</button></div>
            {smtpResult && <p role="status">{smtpResult}</p>}
          </section>}
        </main>
      )}
      {(page === "pop3" || page === "simulations") && <ProtocolTesting adminToken={adminToken} mode={page} />}
      {page === "connections" && (
        <main className="information">
          <h2>{t("connectionTitle")}</h2>
          <p>{t("connectionIntro")}</p>
          <h3>{t("clientConfig")}</h3>
          <table>
            <thead>
              <tr>
                <th>{t("protocol")}</th>
                <th>{t("server")}</th>
                <th>{t("port")}</th>
                <th>{t("security")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>HTTPS API</td>
                <td>{connection?.host || "localhost"}</td>
                <td>{connection?.http?.httpsPort || "—"}</td>
                <td>TLS</td>
              </tr>
              <tr>
                <td>SMTP</td>
                <td>{connection?.host || "localhost"}</td>
                <td>{connection?.smtp?.plainPort || 2525}</td>
                <td>{connection?.smtp?.starttls ? t("starttlsReady") : t("starttlsOff")}</td>
              </tr>
              <tr>
                <td>SMTPS</td>
                <td>{connection?.host || "localhost"}</td>
                <td>{connection?.smtp?.implicitTlsPort || "—"}</td>
                <td>{t("implicitTls")}</td>
              </tr>
              <tr>
                <td>SMS API</td>
                <td>{connection?.host || "localhost"}</td>
                <td>{connection?.http?.httpsPort || connection?.http?.port || 3000}</td>
                <td>HTTP(S)</td>
              </tr>
            </tbody>
          </table>
          <h3>{t("networkValues")}</h3>
          <div className="copyDetails">
            <CopyButton value={connection?.host || "localhost"} label={t("copyHost")} />
            {connection?.http?.httpsPort && (
              <CopyButton
                value={
                  "https://" + (connection.host || "localhost") + ":" + connection.http.httpsPort
                }
                label={t("copyHttps")}
              />
            )}
            <CopyButton
              value={
                (connection?.host || "localhost") + ":" + (connection?.smtp?.plainPort || 2525)
              }
              label={t("copySmtp")}
            />
            {connection?.smtp?.implicitTlsPort && (
              <CopyButton
                value={(connection.host || "localhost") + ":" + connection.smtp.implicitTlsPort}
                label={t("copySmtps")}
              />
            )}
          </div>
          <h3>{t("addresses")}</h3>
          <p className="tlsHelp">{t("tlsHelpNetwork")}</p>
          <div className="tlsImport">
            {Object.entries(networkFields).map(([name, value]) => (
              <label key={name}>
                {name}
                <div className="copyField">
                  <input
                    value={value}
                    onChange={(e) => setNetworkFields((p) => ({ ...p, [name]: e.target.value }))}
                  />
                  <CopyButton value={value} label={t("copyValue") + " " + name} />
                </div>
              </label>
            ))}
            <button disabled={!adminToken} onClick={() => void saveNetwork()}>
              {t("saveAddresses")}
            </button>
            {networkStatus && <p role="status">{networkStatus}</p>}
          </div>
          <h3>{t("certInstalled")}</h3>
          <p className="tlsHelp">{t("tlsHelpActive")}</p>
          {activeCertificate && (
            <div className="detail">
              <strong>{t("activeTls")}</strong>
              <p>
                {t("tlsSource")}: {activeCertificate.source}
              </p>
              <p>SAN: {activeCertificate.subjectAltName}</p>
              <p>
                {t("tlsExpires")}: {activeCertificate.validTo}
              </p>
            </div>
          )}
          {connection?.certificate ? (
            <>
              <p>
                {t("issuer")} {connection.certificate.issuer}
              </p>
              <p>
                {t("validity")} {connection.certificate.validTo}
              </p>
              <p>
                {t("fingerprint")} {connection.certificate.fingerprint256}{" "}
                <CopyButton
                  value={connection.certificate.fingerprint256}
                  label={t("copyFingerprint")}
                />
              </p>
              <a href={"/api" + connection.certificate.download} download>
                {t("downloadCert")}
              </a>
              {connection.certificate.caDownload && (
                <p>
                  <a href={"/api" + connection.certificate.caDownload} download>
                    {t("downloadCa")}
                  </a>
                </p>
              )}
            </>
          ) : (
            <p>{t("tlsMissing")}</p>
          )}
          <p className="tiny">{t("privateKeyNotice")}</p>
          <h3>{t("tlsSanNames")}</h3>
          <p className="tlsHelp">{t("tlsHelpSan")}</p>
          <div className="tlsImport">
            <label>
              {t("tlsSanHelp")}
              <input value={tlsNames} onChange={(e) => setTlsNames(e.target.value)} />
            </label>
            <button disabled={!adminToken} onClick={() => void saveTlsNames()}>
              {t("tlsRegenerate")}
            </button>
            {tlsNamesStatus && <p role="status">{tlsNamesStatus}</p>}
          </div>
          <h3>{t("importTls")}</h3>
          <p className="tlsHelp">{t("tlsHelpUpload")}</p>
          <div className="tlsImport">
            <label>
              {t("publicPem")}
              <input
                type="file"
                accept=".pem,.crt"
                onChange={(e) => setTlsCertFile(e.target.files?.[0] || null)}
              />
            </label>
            <label>
              {t("privatePem")}
              <input
                type="file"
                accept=".pem,.key"
                onChange={(e) => setTlsKeyFile(e.target.files?.[0] || null)}
              />
            </label>
            <label>
              {t("adminToken")}
              <input
                type="password"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button
              onClick={() => void importCertificate()}
              disabled={!tlsCertFile || !tlsKeyFile || !adminToken}
            >
              {t("install")}
            </button>
            {tlsStatus && <p role="status">{tlsStatus}</p>}
          </div>
          <h3>{t("tlsAdvancedTitle")}</h3>
          <p className="tlsHelp">{t("tlsHelpExternal")}</p>
        </main>
      )}
      {page === "documentation" && (
        <main className="information">
          <h2>{t("documentation")}</h2>
          <DocumentSearch onNavigate={navigateSearch} />
          <p className="muted">{t("documentationHelp")}</p>
          <div className="docJourneys">
            {[
              ["demo", t("try"), t("tryDescription")],
              ["integration", t("mock"), t("mockDescription")],
              ["sdk", t("testing"), t("testingDescription")],
            ].map(([id, title, description]) => (
              <button
                className={"docJourney" + (docPage === id ? " active" : "")}
                key={id}
                onClick={() => setDocPage(id)}
              >
                <strong>{title}</strong>
                <small>{description}</small>
              </button>
            ))}
          </div>
          <div className="docPicker">
            <span>{t("reference")}</span>
            {[
              ["overview", t("intro")],
              ["tls", t("tls")],
              ["architecture", t("architecture")],
              ["development", t("development")],
            ].map(([id, title]) => (
              <button aria-pressed={docPage === id} key={id} onClick={() => setDocPage(id)}>
                {title}
              </button>
            ))}
          </div>
          <article className="docMarkdown">
            <MarkdownView markdown={docText} onDocument={openDocument} />
          </article>
        </main>
      )}
      {page === "api" && (
        <main className="information">
          <h2>{t("apiTitle")}</h2>
          <DocumentSearch onNavigate={navigateSearch} />
          <p>{t("apiNote")}</p>
          <article className="docMarkdown">
            <MarkdownView markdown={apiText} onDocument={openDocument} />
          </article>
        </main>
      )}
      {modal && (
        <div className="modalBackdrop">
          <div className="modal">
            <h2>{t("addInbox")}</h2>
            <label>
              {t("identifier")}
              <input
                value={identifier}
                placeholder={
                  modal === "email"
                    ? {
                        "pt-PT": "joao.silva@sandbox.test",
                        "en-US": "olivia.smith@sandbox.test",
                        "fr-FR": "dupont.camille@sandbox.test",
                      }[identityPrefs.locale]
                    : {
                        "pt-PT": identityPrefs.includeCountryCode ? "+351912345401" : "912345401",
                        "en-US": identityPrefs.includeCountryCode ? "+12025550401" : "2025550401",
                        "fr-FR": identityPrefs.includeCountryCode ? "+33612345401" : "0612345401",
                      }[identityPrefs.locale]
                }
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setMissing(false);
                  setError("");
                }}
              />
            </label>
            <IdentityControls
              channel={modal}
              value={identityPrefs}
              onChange={changeIdentityPrefs}
              options={identityOptions}
            />
            {identifier.trim() && (
              <span className={classify(identifier.trim()) ? "success" : "error"}>
                {classify(identifier.trim()) === "email"
                  ? "✓ Email"
                  : classify(identifier.trim()) === "sms"
                    ? "✓ SMS"
                    : "Identificador inválido"}
              </span>
            )}
            <div className="row">
              <button
                className="clock"
                title={t("configureTtl")}
                onClick={() => setTtlOpen((v) => !v)}
              >
                ⏱
              </button>
              {ttlOpen && (
                <label>
                  {t("ttl")}
                  <input
                    type="number"
                    min="1"
                    max="604800"
                    value={ttl}
                    onChange={(e) => setTtl(e.target.value)}
                  />
                </label>
              )}
            </div>
            {missing && <p>{t("missingInbox")}</p>}
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button onClick={() => setModal(null)}>{t("cancel")}</button>
              <button
                disabled={!!identifier.trim() && !classify(identifier.trim())}
                onClick={() => void (missing || !identifier.trim() ? create() : addExisting())}
              >
                {missing ? t("create") : identifier.trim() ? t("addInbox") : t("createRandom")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
