import * as React from "react";
import dynamic from "next/dynamic";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { receiveDiveExport, downloadDiveExport } from "./lib/dive-export.mjs";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  ChartColumn,
  ChartLine,
  CircleAlert,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  Map as MapIcon,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ShieldCheck,
  KeyRound,
  Unplug,
  Settings2,
  Sun,
  Table,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_APP_TITLE } from "./lib/app-meta.mjs";

const ChatPanel = dynamic(() => import("@/components/chat-panel"), { ssr: false });

function clearChatSessionHistory() {
  return import("@/components/chat-panel")
    .then(({ clearChatHistory }) => clearChatHistory())
    .catch(() => {});
}

const EMBED_ORIGIN = "https://embed-motherduck.com";
const EMBED_BASE = `${EMBED_ORIGIN}/sandbox/`;
const STATE_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
// Automatic retries before the frame shows an error card, in milliseconds.
const RETRY_DELAYS = [2000, 6000];
const ICONS = {
  "layout-dashboard": LayoutDashboard,
  table: Table,
  "chart-column": ChartColumn,
  "chart-line": ChartLine,
  map: MapIcon,
  "file-text": FileText,
  users: Users,
  database: Database,
};

// All interface text in one place, so a demo can rename things without hunting.
const COPY = {
  defaultTitle: DEFAULT_APP_TITLE,
  signInTitle: "Sign in",
  signInBody: "Enter the password to open the Dives.",
  password: "Password",
  signIn: "Sign in",
  signingIn: "Signing in",
  showPassword: "Show password",
  hidePassword: "Hide password",
  invalidPassword: "That password was not accepted.",
  tooManyAttempts: "Too many attempts. Wait a few minutes and try again.",
  authNotConfigured: "Sign in is not configured. Set DEMO_PASSWORD and a SESSION_SECRET of at least 32 characters.",
  authUnavailable: "Sign in is temporarily unavailable. Try again shortly.",
  requiredPassword: "Enter the password to continue.",
  devPasswordLead: "Local development password:",
  accountsBody: "Sign in with your username and password.",
  username: "Username",
  requiredCredentials: "Enter your username and password.",
  invalidCredentials: "That username and password were not accepted.",
  banned: "This account is disabled. Contact your administrator.",
  ssoDivider: "or",
  ssoWith: "Continue with {label}",
  ssoFailed: "Single sign-on did not complete. Try again or contact your administrator.",
  admin: "Admin",
  signedInAs: "Signed in as {name}",
  dives: "Dives",
  chooseDive: "Choose a Dive.",
  resizeSidebar: "Resize sidebar",
  collapseSidebar: "Collapse sidebar",
  expandSidebar: "Expand sidebar",
  notConnected: "Not connected",
  chat: "Chat",
  chatAbout: "Ask about the displayed Dive.",
  resizeChat: "Resize chat",
  signOut: "Sign out",
  theme: "Theme",
  light: "Light",
  dark: "Dark",
  menu: "Menu",
  loading: "Loading…",
  loadDives: "Loading Dives…",
  divesUnavailable: "The Dive list is unavailable. Try again shortly.",
  setupTitle: "Connect this Dive",
  setupBody: "Set these environment variables, then restart the app:",
  setupHint: "See the README for what each one holds.",
  unavailableTitle: "Dive unavailable",
  unavailableBody: "The Dive could not be opened. Try again shortly.",
  openMotherDuck: "Open in MotherDuck",
  retry: "Try again",
  openLink: "Open link",
  linkRequest: "The Dive wants to open a link",
  dismiss: "Dismiss",
  exportFailed: "Export failed. Try again.",
};

function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function readStored(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is an optional convenience, never a requirement for access.
  }
}

function useStoredPreference(key, fallback) {
  const [value, setValue] = React.useState(() => readStored(key, fallback));
  const update = React.useCallback((next) => {
    setValue(next);
    writeStored(key, next);
  }, [key]);
  return [value, update];
}

// Same rules as the server: plain JSON, simple keys, at most 8 KB.
function sanitizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = Object.fromEntries(Object.entries(value).filter(([key]) => STATE_KEY.test(key)));
  try {
    const serialized = JSON.stringify(state);
    if (serialized.length > 8192) return undefined;
    return JSON.parse(serialized);
  } catch {
    return undefined;
  }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = undefined;
  }
  return { response, data };
}

function IconTip({ label, children }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ThemeButton({ theme, setTheme }) {
  const isDark = theme === "dark";
  const label = `${COPY.theme}: ${isDark ? COPY.light : COPY.dark}`;
  return (
    <IconTip label={label}><Button variant="ghost" size="icon-sm" className="theme-button" onClick={() => setTheme(isDark ? "light" : "dark")} aria-label={label}>
      {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button></IconTip>
  );
}

function LoginView({ appTitle, devPassword, mode, sso = [], theme, setTheme, onSubmit, onSso }) {
  const accounts = mode === "accounts";
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  // Better Auth returns here with ?sso=failed when a provider or the domain allowlist refused.
  const [state, setState] = React.useState(() => ({ busy: false, error: typeof window !== "undefined" && new URLSearchParams(window.location.search).get("sso") === "failed" ? COPY.ssoFailed : "" }));

  const submit = async (event) => {
    event.preventDefault();
    if (!password || (accounts && !username.trim())) {
      setState({ busy: false, error: accounts ? COPY.requiredCredentials : COPY.requiredPassword });
      return;
    }
    setState({ busy: true, error: "" });
    const result = await onSubmit(accounts ? { username: username.trim(), password } : { password });
    if (!result.ok) {
      const error = {
        invalid_password: COPY.invalidPassword,
        invalid_credentials: COPY.invalidCredentials,
        banned: COPY.banned,
        too_many_attempts: COPY.tooManyAttempts,
        auth_not_configured: COPY.authNotConfigured,
      }[result.error] || COPY.authUnavailable;
      setState({ busy: false, error });
      return;
    }
    setPassword("");
    setState({ busy: false, error: "" });
  };

  return (
    <div className="login-shell">
      <div className="login-theme">
        <ThemeButton theme={theme} setTheme={setTheme} />
      </div>
      <main className="login-main">
        <div className="login-brand"><h1>{appTitle}</h1><p>Your dashboards, with an AI data assistant.</p></div>
        <Card className="login-card">
          <CardHeader>
            <CardTitle id="auth-title" className="login-title">{COPY.signInTitle}</CardTitle>
            <CardDescription>{accounts ? COPY.accountsBody : COPY.signInBody}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="login-form" onSubmit={submit} noValidate aria-labelledby="auth-title">
              {accounts && (
                <div className="login-field">
                  <Label htmlFor="username-input">{COPY.username}</Label>
                  <Input id="username-input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus aria-invalid={Boolean(state.error)} aria-describedby="auth-status" disabled={state.busy} />
                </div>
              )}
              <div className="login-field">
                <Label htmlFor="password-input">{COPY.password}</Label>
                <InputGroup className="login-input">
                  <InputGroupInput
                    id="password-input"
                    type={visible ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    autoFocus={!accounts}
                    aria-invalid={Boolean(state.error)}
                    aria-describedby="auth-status"
                    disabled={state.busy}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" onClick={() => setVisible((value) => !value)} aria-label={visible ? COPY.hidePassword : COPY.showPassword} title={visible ? COPY.hidePassword : COPY.showPassword}>
                      {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </div>
              <p id="auth-status" className="login-error" role="status" aria-live="polite">
                {state.error && <><CircleAlert aria-hidden="true" />{state.error}</>}
              </p>
              <Button className="login-submit" type="submit" disabled={state.busy}>
                {state.busy && <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" />}
                {state.busy ? COPY.signingIn : COPY.signIn}
              </Button>
            </form>
            {accounts && sso.length > 0 && (
              <div className="login-sso">
                <p className="login-sso-divider"><span>{COPY.ssoDivider}</span></p>
                {sso.map((provider) => (
                  <Button key={provider.id} type="button" variant="outline" className="login-submit" disabled={state.busy} onClick={() => { setState({ busy: true, error: "" }); onSso(provider.id).catch(() => setState({ busy: false, error: COPY.ssoFailed })); }}>
                    <KeyRound data-icon="inline-start" aria-hidden="true" />{fill(COPY.ssoWith, { label: provider.label })}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
          {devPassword && (
            <CardFooter className="login-footer">
              <p>{COPY.devPasswordLead} <code>{devPassword}</code></p>
            </CardFooter>
          )}
        </Card>
      </main>
    </div>
  );
}

function DiveSidebar({ dives, selectedKey, onSelect, onSignOut, user }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const select = (key) => {
    onSelect(key);
    if (isMobile) setOpenMobile(false);
  };
  return (
    <Sidebar mobileTitle={COPY.dives} mobileDescription={COPY.chooseDive} collapsible={isMobile ? "offcanvas" : "none"} className="app-sidebar" style={{ "--sidebar-width": "100%" }}>
      <SidebarContent>
        <SidebarGroup className="workspace-nav-group">
          <SidebarGroupLabel>{COPY.dives}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="workspace-menu">
              {dives.map((dive) => {
                const Icon = ICONS[dive.icon] || LayoutDashboard;
                return (
                  <SidebarMenuItem key={dive.key}>
                    <SidebarMenuButton size={dive.description ? "lg" : "default"} isActive={selectedKey === dive.key} onClick={() => select(dive.key)} className="workspace-menu-button" title={dive.description || dive.title}>
                      <span className="workspace-icon" aria-hidden="true"><Icon /></span>
                      <span className="workspace-text">
                        <span className="workspace-name">
                          <span>{dive.title}</span>
                          {!dive.connected && <span className="not-connected-dot" title={COPY.notConnected}><span className="sr-only">{COPY.notConnected}</span></span>}
                        </span>
                        {dive.description && <span className="workspace-hint">{dive.description}</span>}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="sidebar-footer">
        <SidebarMenu>
          {user?.isAdmin && (
            <SidebarMenuItem>
              <SidebarMenuButton className="sign-out-button" render={<a href="/admin" />}><ShieldCheck aria-hidden="true" /><span>{COPY.admin}</span></SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton className="sign-out-button" onClick={onSignOut} title={user?.name ? fill(COPY.signedInAs, { name: user.username || user.name }) : undefined}><LogOut aria-hidden="true" /><span>{COPY.signOut}</span></SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function LinkBanner({ request, onDismiss }) {
  if (!request) return null;
  return (
    <Alert className="source-alert" role="status" aria-live="polite">
      <ExternalLink aria-hidden="true" />
      <AlertTitle>{COPY.linkRequest}</AlertTitle>
      <AlertDescription className="source-domain">{request.hostname}</AlertDescription>
      <AlertAction className="source-actions">
        <Button size="xs" nativeButton={false} render={<a href={request.href} target="_blank" rel="noopener noreferrer" />}>{COPY.openLink}</Button>
        <Button size="xs" variant="ghost" onClick={onDismiss}>{COPY.dismiss}</Button>
      </AlertAction>
    </Alert>
  );
}

function OpenInMotherDuck({ url }) {
  if (!url) return null;
  return (
    <Button variant="link" size="sm" nativeButton={false} render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
      {COPY.openMotherDuck} <ExternalLink data-icon="inline-end" aria-hidden="true" />
    </Button>
  );
}

function SetupCard({ dive, missing }) {
  return (
    <Empty className="embed-empty" role="status">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Settings2 aria-hidden="true" /></EmptyMedia>
        <Badge variant="outline" className="setup-badge">{COPY.notConnected}</Badge>
        <EmptyTitle>{COPY.setupTitle}</EmptyTitle>
        <EmptyDescription>{COPY.setupBody}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ul className="setup-env-list">
          {missing.map((name) => <li key={name}><code>{name}</code></li>)}
        </ul>
        <EmptyDescription>{COPY.setupHint}</EmptyDescription>
        <OpenInMotherDuck url={dive.url} />
      </EmptyContent>
    </Empty>
  );
}

function UnavailableCard({ dive, onRetry }) {
  return (
    <Empty className="embed-empty" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Unplug aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>{COPY.unavailableTitle}</EmptyTitle>
        <EmptyDescription>{COPY.unavailableBody}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="embed-actions">
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          {COPY.retry}
        </Button>
        <OpenInMotherDuck url={dive.url} />
      </EmptyContent>
    </Empty>
  );
}

function DiveSkeleton() {
  return (
    <div className="frame-loading" role="status" aria-label={COPY.loading}>
      <div className="skeleton-heading"><Skeleton className="h-7 w-52" /><Skeleton className="h-4 w-72" /></div>
      <div className="skeleton-kpis">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      <Skeleton className="skeleton-table" />
    </div>
  );
}

// Hosts one embedded Dive: fetches a short-lived session, passes it in the URL hash
// (never the query string), renews it before expiry and relays the Dive's messages.
function DiveFrame({ theme, dive, onStatusChange, onStateChange }) {
  const frameRef = React.useRef(null);
  const pendingExports = React.useRef(new Map());
  const [exportFailed, setExportFailed] = React.useState(false);
  const [frameSrc, setFrameSrc] = React.useState("");
  const [frameKey, setFrameKey] = React.useState(0);
  const [status, setStatus] = React.useState("loading");
  const [missing, setMissing] = React.useState(dive.missing || []);
  const [linkRequest, setLinkRequest] = React.useState(null);
  const stateRef = React.useRef(undefined);
  const timerRef = React.useRef();
  const loadTimerRef = React.useRef();
  const requestRef = React.useRef();
  const requestIdRef = React.useRef(0);
  const linkHosts = React.useMemo(() => new Set(dive.linkHosts || []), [dive.linkHosts]);
  React.useEffect(() => { onStatusChange(status); }, [status, onStatusChange]);

  const requestSession = React.useCallback(async (signal) => {
    const state = stateRef.current;
    const result = state
      ? await jsonRequest("/api/embed", { method: "POST", signal, body: JSON.stringify({ dive: dive.key, theme, state }) })
      : await jsonRequest(`/api/embed?${new URLSearchParams({ dive: dive.key, theme })}`, { signal });
    if (result.data?.error === "embedding_not_configured") {
      const error = new Error("embedding_not_configured");
      error.missing = Array.isArray(result.data.missing) ? result.data.missing : [];
      throw error;
    }
    if (!result.response.ok || !result.data?.session) throw new Error(result.data?.error || "embed_unavailable");
    return result.data;
  }, [dive.key, theme]);

  const openDive = React.useCallback(async (attempt = 0) => {
    const requestId = ++requestIdRef.current;
    window.clearTimeout(timerRef.current);
    window.clearTimeout(loadTimerRef.current);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    try {
      const data = await requestSession(AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
      if (requestId !== requestIdRef.current) return;
      const url = new URL(EMBED_BASE);
      url.hash = `session=${encodeURIComponent(data.session)}`;
      setFrameSrc(url.toString());
      pendingExports.current.clear();
      setFrameKey(requestId);
      loadTimerRef.current = window.setTimeout(() => {
        if (requestId === requestIdRef.current) setStatus("error");
      }, 30000);
      const seconds = Number(data.expires_in);
      if (Number.isFinite(seconds)) {
        timerRef.current = window.setTimeout(() => openDive(), Math.max(10000, (seconds - 60) * 1000));
      }
    } catch (error) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return;
      if (error.message === "embedding_not_configured") {
        setMissing(error.missing);
        setStatus("configuration");
        return;
      }
      if (error.message === "authentication_required") {
        window.location.reload();
        return;
      }
      if (attempt < RETRY_DELAYS.length) {
        timerRef.current = window.setTimeout(() => openDive(attempt + 1), RETRY_DELAYS[attempt]);
        return;
      }
      setStatus("error");
    }
  }, [requestSession]);

  React.useEffect(() => {
    if (!dive.connected) {
      setStatus("configuration");
      setFrameSrc("");
      return undefined;
    }
    openDive();
    return () => {
      ++requestIdRef.current;
      requestRef.current?.abort();
      window.clearTimeout(timerRef.current);
      window.clearTimeout(loadTimerRef.current);
    };
  }, [dive.connected, openDive]);

  React.useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== EMBED_ORIGIN || event.source !== frameRef.current?.contentWindow) return;
      const exported = receiveDiveExport(event, frameRef.current?.contentWindow, pendingExports.current);
      if (exported) {
        if (exported.type === "started") setExportFailed(false);
        if (exported.type === "error") setExportFailed(true);
        if (exported.type === "file") {
          try {
            downloadDiveExport(exported);
            setExportFailed(false);
          } catch {
            setExportFailed(true);
          }
        }
        return;
      }
      const message = event.data;
      if (!message || typeof message !== "object") return;
      if (message.type === "dive-state-update") {
        stateRef.current = sanitizeState(message.state);
        onStateChange?.(stateRef.current || {});
        return;
      }
      if (["navigation-request", "dive-navigation-request", "open-link"].includes(message.type)) {
        let requested;
        try {
          requested = new URL(typeof message.url === "string" ? message.url : message.href);
        } catch {
          return;
        }
        if (requested.protocol !== "https:" || !linkHosts.has(requested.hostname)) return;
        setLinkRequest({ href: requested.toString(), hostname: requested.hostname });
        return;
      }
      if (["dive-session-expired", "session-expired", "auth-expired"].includes(message.type)) openDive();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [linkHosts, onStateChange, openDive]);

  return (
    <div className="workbench-frame-region">
      <LinkBanner request={linkRequest} onDismiss={() => setLinkRequest(null)} />
      {exportFailed && <Alert variant="destructive" className="export-alert" role="alert"><CircleAlert aria-hidden="true" /><AlertTitle>{COPY.exportFailed}</AlertTitle></Alert>}
      <div className="frame-wrap">
        {status === "loading" && <DiveSkeleton />}
        {status === "configuration" && <SetupCard dive={dive} missing={dive.connected ? missing : dive.missing} />}
        {status === "error" && <UnavailableCard dive={dive} onRetry={() => openDive()} />}
        {frameSrc && (
          <iframe
            key={frameKey}
            src={frameSrc}
            ref={frameRef}
            title={dive.title}
            className={cn("dive-frame", status === "ready" && "is-ready")}
            sandbox="allow-scripts allow-same-origin allow-downloads"
            referrerPolicy="no-referrer"
            onLoad={() => {
              if (frameKey === requestIdRef.current && frameRef.current?.src.startsWith(EMBED_BASE)) {
                window.clearTimeout(loadTimerRef.current);
                setStatus("ready");
              }
            }}
            inert={status !== "ready"}
            aria-hidden={status !== "ready"}
            style={status !== "ready" ? { position: "absolute", inset: 0, height: "100%", pointerEvents: "none" } : undefined}
          />
        )}
      </div>
    </div>
  );
}

function MainContent({ appTitle, theme, setTheme, dive, dives, onSelectDive, onSignOut, user }) {
  const isMobile = useIsMobile();
  const [frameStatus, setFrameStatus] = React.useState("loading");
  const [chatOpen, setChatOpen] = React.useState(false);
  const [wideChat, setWideChat] = React.useState(false);
  const [diveState, setDiveState] = React.useState({});
  React.useEffect(() => {
    const media = window.matchMedia("(min-width:1100px)");
    const update = () => setWideChat(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  React.useEffect(() => { setDiveState({}); }, [dive.key]);

  const [sidebarDefaultWidth] = React.useState(() => {
    const width = Number(readStored("dive_app_sidebar_width", "240"));
    return width >= 190 && width <= 420 ? width : 240;
  });
  const layoutRef = React.useRef(null);
  const navigationRef = React.useRef(null);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  React.useEffect(() => {
    const finish = () => document.body.classList.remove("is-sidebar-resizing");
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    window.addEventListener("blur", finish);
    return () => {
      finish();
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      window.removeEventListener("blur", finish);
    };
  }, []);
  const rememberSidebar = React.useCallback((layout, meta) => {
    const navigationPercent = Number(layout?.navigation);
    const collapsed = Number.isFinite(navigationPercent) && navigationPercent <= 0.1;
    setSidebarCollapsed(collapsed);
    if (collapsed || !meta?.isUserInteraction || !layoutRef.current) return;
    const group = layoutRef.current;
    const separators = [...group.querySelectorAll('[data-slot="resizable-handle"]')].reduce((sum, node) => sum + node.getBoundingClientRect().width, 0);
    const width = Math.round((group.getBoundingClientRect().width - separators) * layout.navigation / 100);
    writeStored("dive_app_sidebar_width", String(Math.min(420, Math.max(190, width))));
  }, []);
  const toggleSidebar = React.useCallback(() => {
    const panel = navigationRef.current;
    if (!panel) return;
    if (sidebarCollapsed || panel.isCollapsed()) {
      panel.expand();
      setSidebarCollapsed(false);
    } else {
      panel.collapse();
      setSidebarCollapsed(true);
    }
  }, [sidebarCollapsed]);

  const sidebar = <DiveSidebar dives={dives} selectedKey={dive.key} onSelect={onSelectDive} onSignOut={onSignOut} user={user} />;
  const sidebarLabel = sidebarCollapsed ? COPY.expandSidebar : COPY.collapseSidebar;

  const header = (
    <header className="workspace-topbar">
      <h1 className="sr-only">{appTitle}</h1>
      {isMobile && <SidebarTrigger className="mobile-menu-button" aria-label={COPY.menu} />}
      {!isMobile && (
        <IconTip label={sidebarLabel}>
          <Button variant="ghost" size="icon-sm" className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarLabel}>
            {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </Button>
        </IconTip>
      )}
      <Separator orientation="vertical" className="topbar-separator" />
      <Breadcrumb className="workspace-topbar-title">
        <BreadcrumbList>
          <BreadcrumbItem className="topbar-crumb-parent">{appTitle}</BreadcrumbItem>
          <BreadcrumbSeparator className="topbar-crumb-parent" />
          <BreadcrumbItem><BreadcrumbPage>{dive.title}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="workspace-topbar-actions">
        <Button variant={chatOpen ? "secondary" : "outline"} size="sm" className="chat-toggle" onClick={() => setChatOpen((value) => !value)} aria-pressed={chatOpen}>
          <MessageSquare data-icon="inline-start" aria-hidden="true" />{COPY.chat}
        </Button>
        <ThemeButton theme={theme} setTheme={setTheme} />
        {isMobile && (
          <Button variant="ghost" size="icon-sm" onClick={onSignOut} aria-label={COPY.signOut} title={COPY.signOut}>
            <LogOut aria-hidden="true" />
          </Button>
        )}
      </div>
    </header>
  );

  const content = (
    <div className="workspace-main">
      <main className="workspace-content">
        <DiveFrame key={dive.key} theme={theme} dive={dive} onStatusChange={setFrameStatus} onStateChange={setDiveState} />
      </main>
    </div>
  );

  const chat = <ChatPanel key={dive.key} dive={dive} state={diveState} ready={frameStatus === "ready"} frameStatus={frameStatus} onClose={() => setChatOpen(false)} />;
  const chatSheet = (
    <Sheet open={chatOpen && !wideChat} onOpenChange={setChatOpen}>
      <SheetContent showCloseButton={false} className="chat-sheet" style={{ width: "min(100%,420px)", maxWidth: "100%", gap: 0 }}>
        <SheetHeader className="sr-only">
          <SheetTitle>{COPY.chat}</SheetTitle>
          <SheetDescription>{COPY.chatAbout}</SheetDescription>
        </SheetHeader>
        {chatOpen && !wideChat && chat}
      </SheetContent>
    </Sheet>
  );

  if (isMobile) {
    return <div className="app-shell">{header}<div className="app-layout mobile-layout">{sidebar}{content}</div>{chatSheet}</div>;
  }
  const startResize = () => document.body.classList.add("is-sidebar-resizing");
  return (
    <div className="app-shell">
      {header}
      <ResizablePanelGroup elementRef={layoutRef} orientation="horizontal" resizeTargetMinimumSize={{ fine: 18, coarse: 32 }} onLayoutChanged={rememberSidebar} className="app-layout desktop-layout">
        <ResizablePanel id="navigation" panelRef={navigationRef} collapsible collapsedSize="0px" groupResizeBehavior="preserve-pixel-size" defaultSize={`${sidebarDefaultWidth}px`} minSize="190px" maxSize="420px" className="sidebar-panel">{sidebar}</ResizablePanel>
        <ResizableHandle
          withHandle
          className="sidebar-resizer"
          title={COPY.resizeSidebar}
          aria-label={COPY.resizeSidebar}
          onPointerDownCapture={startResize}
          onDoubleClick={() => {
            navigationRef.current?.resize("240px");
            setSidebarCollapsed(false);
            writeStored("dive_app_sidebar_width", "240");
          }}
        />
        <ResizablePanel id="content" minSize="300px">{content}</ResizablePanel>
        {chatOpen && wideChat && (
          <>
            <ResizableHandle withHandle className="sidebar-resizer" aria-label={COPY.resizeChat} title={COPY.resizeChat} onPointerDownCapture={startResize} />
            <ResizablePanel id="assistant" className="assistant-panel" defaultSize="380px" minSize="320px" maxSize="520px" groupResizeBehavior="preserve-pixel-size">{chat}</ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {chatSheet}
    </div>
  );
}

function AuthenticatedApp({ appTitle, theme, setTheme, dives, selectedKey, setSelectedKey, onSignOut, user }) {
  const dive = dives.find((entry) => entry.key === selectedKey) || dives[0];
  React.useEffect(() => {
    if (dive?.key && dive.key !== selectedKey) setSelectedKey(dive.key);
  }, [selectedKey, setSelectedKey, dive]);
  React.useEffect(() => () => {
    void clearChatSessionHistory();
  }, []);
  return (
    <SidebarProvider defaultOpen>
      <MainContent appTitle={appTitle} theme={theme} setTheme={setTheme} dive={dive} dives={dives} onSelectDive={setSelectedKey} onSignOut={onSignOut} user={user} />
    </SidebarProvider>
  );
}

export default function App() {
  const [theme, setTheme] = useStoredPreference("dive_app_theme", "light");
  const [diveKey, setDiveKey] = useStoredPreference("dive_app_dive", "");
  const [auth, setAuth] = React.useState({ state: "checking", appTitle: COPY.defaultTitle, devPassword: "", mode: "password", sso: [], user: null });
  const [dives, setDives] = React.useState([]);
  const [divesState, setDivesState] = React.useState("loading");

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  React.useEffect(() => {
    document.title = auth.appTitle;
  }, [auth.appTitle]);

  const loadDives = React.useCallback(async () => {
    setDivesState("loading");
    try {
      const { response, data } = await jsonRequest("/api/dives");
      if (!response.ok || !Array.isArray(data?.dives)) throw new Error("dives-unavailable");
      setDives(data.dives);
      setDivesState("ready");
    } catch {
      setDivesState("error");
    }
  }, []);

  const refreshAuth = React.useCallback(async () => {
    try {
      const { response, data } = await jsonRequest("/api/auth");
      const authenticated = response.ok && data?.authenticated === true;
      setAuth({
        state: authenticated ? "authenticated" : "unauthenticated",
        appTitle: typeof data?.appTitle === "string" && data.appTitle ? data.appTitle : COPY.defaultTitle,
        devPassword: typeof data?.devPassword === "string" ? data.devPassword : "",
        mode: data?.mode === "accounts" ? "accounts" : "password",
        sso: Array.isArray(data?.sso) ? data.sso : [],
        user: data?.user || null,
      });
      if (authenticated) loadDives();
    } catch {
      setAuth((current) => ({ ...current, state: "unauthenticated" }));
    }
  }, [loadDives]);

  React.useEffect(() => {
    refreshAuth();
    // Sessions last 8 hours; check again shortly before that.
    const timer = window.setTimeout(refreshAuth, 7.5 * 60 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [refreshAuth]);

  const submitLogin = async ({ username, password }) => {
    if (auth.mode === "accounts") {
      try {
        const { authClient } = await import("./lib/auth-client.js");
        const { error } = await authClient.signIn.username({ username, password });
        if (error) return { ok: false, error: error.status === 429 ? "too_many_attempts" : error.status === 403 ? "banned" : error.status === 401 ? "invalid_credentials" : "unavailable" };
        await refreshAuth();
        return { ok: true };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    }
    try {
      const { response, data } = await jsonRequest("/api/auth", { method: "POST", body: JSON.stringify({ password }) });
      if (!response.ok || data?.authenticated !== true) return { ok: false, error: data?.error };
      setAuth((current) => ({ ...current, state: "authenticated" }));
      await loadDives();
      return { ok: true };
    } catch {
      return { ok: false, error: "unavailable" };
    }
  };

  const signInWithSso = async (provider) => {
    const { authClient } = await import("./lib/auth-client.js");
    const { error } = await authClient.signIn.social({ provider, callbackURL: "/", errorCallbackURL: "/?sso=failed" });
    if (error) throw new Error("sso-failed");
  };

  const signOut = async () => {
    try {
      if (auth.mode === "accounts") {
        const { authClient } = await import("./lib/auth-client.js");
        const { error } = await authClient.signOut();
        if (error) throw new Error("logout-failed");
      }
      const { response } = await jsonRequest("/api/auth", { method: "DELETE" });
      if (!response.ok) throw new Error("logout-failed");
      await clearChatSessionHistory();
      setDives([]);
      setAuth((current) => ({ ...current, state: "unauthenticated" }));
    } catch {
      // The shell stays mounted, so the viewer does not see a false success state.
    }
  };

  if (auth.state === "checking") return <div className="boot-screen"><Spinner className="size-5" /><span>{COPY.loading}</span></div>;
  if (auth.state === "unauthenticated") return <LoginView appTitle={auth.appTitle} devPassword={auth.devPassword} mode={auth.mode} sso={auth.sso} theme={theme} setTheme={setTheme} onSubmit={submitLogin} onSso={signInWithSso} />;
  if (divesState === "loading") return <div className="boot-screen"><Spinner className="size-5" /><span>{COPY.loadDives}</span></div>;
  if (divesState === "error" || dives.length === 0) {
    return (
      <div className="boot-screen">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Unplug aria-hidden="true" /></EmptyMedia>
            <EmptyDescription>{COPY.divesUnavailable}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button variant="outline" size="sm" onClick={loadDives}><RefreshCw data-icon="inline-start" aria-hidden="true" />{COPY.retry}</Button></EmptyContent>
        </Empty>
      </div>
    );
  }
  return <AuthenticatedApp appTitle={auth.appTitle} theme={theme} setTheme={setTheme} dives={dives} selectedKey={diveKey} setSelectedKey={setDiveKey} onSignOut={signOut} user={auth.user} />;
}
