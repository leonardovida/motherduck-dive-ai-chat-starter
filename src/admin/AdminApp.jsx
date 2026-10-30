import * as React from "react";
import { ArrowLeft, Ban, Check, Download, KeyRound, MessageSquare, RefreshCw, Search, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client.js";

// All interface text in one place, like the main app.
const COPY = {
  title: "Admin",
  back: "Back to Dives",
  users: "People",
  conversations: "Conversations",
  accountsOff: "Accounts are not turned on",
  accountsOffBody: "Set MOTHERDUCK_APP_TOKEN, run npm run db:migrate and create the first admin with npm run admin:create. See docs/accounts.md.",
  signIn: "Sign in as an administrator to open this page.",
  notAdmin: "Only administrators can open this page.",
  addPerson: "Add a person",
  addPersonBody: "People sign in with this username and password. Share the password with them through a secure channel.",
  username: "Username",
  name: "Display name",
  email: "Email (optional, used to match single sign-on)",
  password: "Password (12+ characters)",
  generate: "Generate",
  role: "Role",
  roles: { user: "Viewer", admin: "Administrator" },
  access: "Access",
  allDives: "All Dives",
  chat: "AI chat",
  create: "Add person",
  creating: "Adding…",
  created: "Added {name}.",
  copyPassword: "Copy the password now. It is not shown again.",
  everyone: "Everyone",
  active: "Active",
  banned: "Disabled",
  resetPassword: "Set password",
  save: "Save",
  cancel: "Cancel",
  makeAdmin: "Make admin",
  makeViewer: "Make viewer",
  disable: "Disable",
  enable: "Enable",
  remove: "Delete",
  confirmRemove: "Confirm delete",
  editAccess: "Edit access",
  noUsers: "No people yet.",
  failed: "That did not work: {reason}",
  search: "Search titles",
  allPeople: "All people",
  allDivesFilter: "All Dives",
  noConversations: "No saved conversations match.",
  messages: ["1 message", "{n} messages"],
  pick: "Pick a conversation to read it.",
  question: "Question",
  answer: "Answer",
  routed: "Routing",
  tokens: "{input} in · {output} out tokens",
  seconds: "{s}s",
  sql: "SQL",
  tool: { getDiveState: "Read the Dive state", listTables: "Listed tables", describeTable: "Described a table", runQuery: "Ran a query" },
  exportJson: "Export JSON",
  loadMore: "Load more",
  refresh: "Refresh",
  demoTitle: "Public demo",
  demoBody: "Every screen is open to explore. Changes are switched off, so the demo stays the same for every visitor.",
  demoUnavailable: "This is not available in a public demo.",
};
const fill = (template, values) => String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
const plural = ([one, many], n) => fill(n === 1 ? one : many, { n });
const dateTime = value => (value ? new Date(value).toLocaleString() : "");

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}
const unwrap = async promise => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || error.statusText || "request failed");
  return data;
};
const randomPassword = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 20);
};

// In a public demo every change stays visible but switched off, with the reason on hover.
const ReadOnly = React.createContext("");
function WriteButton({ disabled, ...props }) {
  const reason = React.useContext(ReadOnly);
  const button = <Button {...props} disabled={Boolean(reason) || disabled} />;
  return reason ? <span title={reason} className="inline-flex">{button}</span> : button;
}

function Notice({ message, tone = "muted" }) {
  if (!message) return null;
  return <p role="status" className={tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message}</p>;
}

function AccessEditor({ dives, value, onChange }) {
  const all = value.dives === "*";
  const toggle = key => {
    const current = all ? [] : value.dives;
    onChange({ ...value, dives: current.includes(key) ? current.filter(item => item !== key) : [...current, key] });
  };
  return (
    <fieldset className="grid gap-2 text-sm">
      <legend className="mb-1 text-sm font-medium">{COPY.access}</legend>
      <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={() => onChange({ ...value, dives: all ? [] : "*" })} />{COPY.allDives}</label>
      {!all && dives.map(dive => (
        <label key={dive.key} className="flex items-center gap-2 pl-5"><input type="checkbox" checked={value.dives.includes(dive.key)} onChange={() => toggle(dive.key)} />{dive.title}</label>
      ))}
      <label className="flex items-center gap-2"><input type="checkbox" checked={value.chat} onChange={() => onChange({ ...value, chat: !value.chat })} />{COPY.chat}</label>
    </fieldset>
  );
}

const accessOf = user => ({ dives: !user.diveAccess || user.diveAccess === "*" ? "*" : String(user.diveAccess).split(",").filter(Boolean), chat: user.chatAccess !== false });
const saveAccess = (userId, access) => api(`/api/admin/users/${encodeURIComponent(userId)}/access`, { method: "PATCH", body: JSON.stringify(access) });

function CreateUser({ dives, onCreated }) {
  const blank = { username: "", name: "", email: "", password: "", role: "user", access: { dives: "*", chat: true } };
  const [form, setForm] = React.useState(blank);
  const [state, setState] = React.useState({ busy: false, message: "", tone: "muted" });
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const submit = async event => {
    event.preventDefault();
    const username = form.username.trim().toLowerCase();
    if (!/^[a-z0-9_.]{2,40}$/.test(username) || form.password.length < 12) {
      setState({ busy: false, message: fill(COPY.failed, { reason: "use a 2-40 character username of letters, digits, dots or underscores and a password of 12+ characters" }), tone: "error" });
      return;
    }
    setState({ busy: true, message: "", tone: "muted" });
    try {
      const { user } = await unwrap(authClient.admin.createUser({ email: form.email.trim() || `${username}@accounts.invalid`, password: form.password, name: form.name.trim() || username, role: form.role, data: { username, displayUsername: username } }));
      await saveAccess(user.id, form.access);
      setForm(blank);
      setState({ busy: false, message: fill(COPY.created, { name: username }), tone: "muted" });
      onCreated();
    } catch (error) {
      setState({ busy: false, message: fill(COPY.failed, { reason: error.message }), tone: "error" });
    }
  };
  return (
    <Card>
      <CardHeader><CardTitle>{COPY.addPerson}</CardTitle><CardDescription>{COPY.addPersonBody}</CardDescription></CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
          <div className="grid gap-1.5"><Label htmlFor="new-username">{COPY.username}</Label><Input id="new-username" value={form.username} onChange={e => set("username", e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required /></div>
          <div className="grid gap-1.5"><Label htmlFor="new-name">{COPY.name}</Label><Input id="new-name" value={form.name} onChange={e => set("name", e.target.value)} autoComplete="off" /></div>
          <div className="grid gap-1.5"><Label htmlFor="new-email">{COPY.email}</Label><Input id="new-email" type="email" value={form.email} onChange={e => set("email", e.target.value)} autoComplete="off" /></div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-password">{COPY.password}</Label>
            <div className="flex gap-2"><Input id="new-password" value={form.password} onChange={e => set("password", e.target.value)} autoComplete="new-password" spellCheck={false} required /><Button type="button" variant="outline" onClick={() => set("password", randomPassword())}><KeyRound data-icon="inline-start" aria-hidden="true" />{COPY.generate}</Button></div>
            {form.password && <span className="text-xs text-muted-foreground">{COPY.copyPassword}</span>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-role">{COPY.role}</Label>
            <select id="new-role" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={form.role} onChange={e => set("role", e.target.value)}>
              {Object.entries(COPY.roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <AccessEditor dives={dives} value={form.access} onChange={access => set("access", access)} />
          <div className="flex items-center gap-3 md:col-span-2">
            <WriteButton type="submit" disabled={state.busy}>{state.busy ? <Spinner data-icon="inline-start" /> : <UserPlus data-icon="inline-start" aria-hidden="true" />}{state.busy ? COPY.creating : COPY.create}</WriteButton>
            <Notice message={state.message} tone={state.tone} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function UserRow({ user, dives, self, onChanged }) {
  const [mode, setMode] = React.useState(null);
  const [password, setPassword] = React.useState("");
  const [access, setAccess] = React.useState(accessOf(user));
  const [state, setState] = React.useState({ busy: false, message: "" });
  const isAdmin = String(user.role).split(",").includes("admin");
  const run = async action => {
    setState({ busy: true, message: "" });
    try { await action(); setMode(null); setPassword(""); setState({ busy: false, message: "" }); onChanged(); }
    catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: error.message }) }); }
  };
  const diveNames = access.dives === "*" ? COPY.allDives : dives.filter(dive => access.dives.includes(dive.key)).map(dive => dive.title).join(", ") || "—";
  return (
    <li className="grid gap-3 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{user.displayUsername || user.username || user.email}</span>
        <span className="text-sm text-muted-foreground">{user.name}</span>
        <Badge variant={isAdmin ? "default" : "secondary"}>{isAdmin ? COPY.roles.admin : COPY.roles.user}</Badge>
        {user.banned && <Badge variant="destructive">{COPY.banned}</Badge>}
        <span className="text-xs text-muted-foreground">{diveNames} · {COPY.chat} {access.chat ? "✓" : "✗"}</span>
        <span className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => setMode(mode === "password" ? null : "password")}><KeyRound data-icon="inline-start" aria-hidden="true" />{COPY.resetPassword}</Button>
          <Button size="sm" variant="ghost" onClick={() => setMode(mode === "access" ? null : "access")}>{COPY.editAccess}</Button>
          {!self && <WriteButton size="sm" variant="ghost" disabled={state.busy} onClick={() => run(() => unwrap(authClient.admin.setRole({ userId: user.id, role: isAdmin ? "user" : "admin" })))}><ShieldCheck data-icon="inline-start" aria-hidden="true" />{isAdmin ? COPY.makeViewer : COPY.makeAdmin}</WriteButton>}
          {!self && <WriteButton size="sm" variant="ghost" disabled={state.busy} onClick={() => run(() => unwrap(user.banned ? authClient.admin.unbanUser({ userId: user.id }) : authClient.admin.banUser({ userId: user.id })))}>{user.banned ? <Check data-icon="inline-start" aria-hidden="true" /> : <Ban data-icon="inline-start" aria-hidden="true" />}{user.banned ? COPY.enable : COPY.disable}</WriteButton>}
          {!self && (mode === "remove"
            ? <Button size="sm" variant="destructive" disabled={state.busy} onClick={() => run(() => unwrap(authClient.admin.removeUser({ userId: user.id })))}><Trash2 data-icon="inline-start" aria-hidden="true" />{COPY.confirmRemove}</Button>
            : <WriteButton size="sm" variant="ghost" onClick={() => setMode("remove")}><Trash2 data-icon="inline-start" aria-hidden="true" />{COPY.remove}</WriteButton>)}
        </span>
      </div>
      {mode === "password" && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (password.length >= 12) run(() => unwrap(authClient.admin.setUserPassword({ userId: user.id, newPassword: password }))); }}>
          <Input className="max-w-xs" aria-label={COPY.password} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" spellCheck={false} placeholder={COPY.password} />
          <Button type="button" variant="outline" size="sm" onClick={() => setPassword(randomPassword())}>{COPY.generate}</Button>
          <WriteButton type="submit" size="sm" disabled={state.busy || password.length < 12}>{COPY.save}</WriteButton>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>{COPY.cancel}</Button>
        </form>
      )}
      {mode === "access" && (
        <div className="grid gap-3">
          <AccessEditor dives={dives} value={access} onChange={setAccess} />
          <div className="flex gap-2"><WriteButton size="sm" disabled={state.busy} onClick={() => run(() => saveAccess(user.id, access))}>{COPY.save}</WriteButton><Button size="sm" variant="ghost" onClick={() => { setAccess(accessOf(user)); setMode(null); }}>{COPY.cancel}</Button></div>
        </div>
      )}
      <Notice message={state.message} tone="error" />
    </li>
  );
}

function UsersTab({ users, dives, me, reload, loading }) {
  return (
    <div className="grid gap-6">
      <CreateUser dives={dives} onCreated={reload} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle>{COPY.users}</CardTitle><Button size="sm" variant="ghost" onClick={reload} disabled={loading}><RefreshCw data-icon="inline-start" aria-hidden="true" />{COPY.refresh}</Button></CardHeader>
        <CardContent>
          {users.length ? <ul className="grid">{users.map(user => <UserRow key={`${user.id}:${user.updatedAt}`} user={user} dives={dives} self={user.id === me?.id} onChanged={reload} />)}</ul> : <p className="text-sm text-muted-foreground">{COPY.noUsers}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function ConversationDetail({ id, onDeleted }) {
  const [conversation, setConversation] = React.useState(null);
  const [error, setError] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    setConversation(null); setError(""); setConfirming(false);
    api(`/api/admin/conversations/${encodeURIComponent(id)}`).then(data => active && setConversation(data.conversation)).catch(err => active && setError(err.message));
    return () => { active = false; };
  }, [id]);
  if (error) return <Notice message={fill(COPY.failed, { reason: error })} tone="error" />;
  if (!conversation) return <Spinner />;
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(conversation, null, 2)], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `conversation-${conversation.id}.json` });
    link.click();
    URL.revokeObjectURL(url);
  };
  const remove = async () => {
    try { await api(`/api/admin/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }); onDeleted(); }
    catch (err) { setError(err.message); }
  };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto"><h3 className="font-medium">{conversation.title}</h3><p className="text-xs text-muted-foreground">{conversation.user_label} · {conversation.dive_key} · {dateTime(conversation.created_at)}</p></div>
        <Button size="sm" variant="outline" onClick={exportJson}><Download data-icon="inline-start" aria-hidden="true" />{COPY.exportJson}</Button>
        {confirming
          ? <Button size="sm" variant="destructive" onClick={remove}><Trash2 data-icon="inline-start" aria-hidden="true" />{COPY.confirmRemove}</Button>
          : <WriteButton size="sm" variant="ghost" onClick={() => setConfirming(true)}><Trash2 data-icon="inline-start" aria-hidden="true" />{COPY.remove}</WriteButton>}
      </div>
      <ol className="grid gap-3">
        {conversation.messages.map(message => (
          <li key={message.id} className={message.role === "user" ? "rounded-md bg-muted px-3 py-2" : "rounded-md border border-border px-3 py-2"}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{message.role === "user" ? COPY.question : COPY.answer} · {dateTime(message.created_at)}</p>
            <p className="whitespace-pre-wrap text-sm">{message.content}</p>
            {message.role === "assistant" && (
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                {message.model_tier && <span>{[message.model_tier, message.model_provider, message.model_id].filter(Boolean).join(" · ")}{message.worked_ms != null ? ` · ${fill(COPY.seconds, { s: (Number(message.worked_ms) / 1000).toFixed(1) })}` : ""}{message.input_tokens != null ? ` · ${fill(COPY.tokens, { input: message.input_tokens, output: message.output_tokens })}` : ""}</span>}
                {message.route_reason && <span>{COPY.routed}: {message.route_reason}</span>}
                {(message.tools || []).map((tool, index) => (
                  <details key={index} className="rounded border border-border px-2 py-1">
                    <summary className="cursor-pointer">{COPY.tool[tool.tool] || tool.tool}{tool.purpose ? ` · ${tool.purpose}` : ""}{tool.table ? ` · ${tool.table}` : ""}{typeof tool.rowCount === "number" ? ` · ${tool.rowCount}${tool.truncated ? "+" : ""} rows` : ""}{tool.error ? ` · ${tool.error}` : ""}</summary>
                    {tool.sql && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">{tool.sql}</pre>}
                  </details>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ConversationsTab({ users, dives }) {
  const [filters, setFilters] = React.useState({ user: "", dive: "", q: "" });
  const [items, setItems] = React.useState([]);
  const [state, setState] = React.useState({ loading: true, error: "", more: false });
  const [selected, setSelected] = React.useState(null);
  const load = React.useCallback(async (offset = 0) => {
    setState(current => ({ ...current, loading: true, error: "" }));
    const params = new URLSearchParams({ limit: "50", offset: String(offset), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) });
    try {
      const { conversations } = await api(`/api/admin/conversations?${params}`);
      setItems(current => (offset ? [...current, ...conversations] : conversations));
      setState({ loading: false, error: "", more: conversations.length === 50 });
    } catch (error) { setState({ loading: false, error: error.message, more: false }); }
  }, [filters]);
  React.useEffect(() => { const timer = setTimeout(() => load(0), 250); return () => clearTimeout(timer); }, [load]);
  const select = "h-9 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card className="min-w-0">
        <CardHeader className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <select aria-label={COPY.allPeople} className={select} value={filters.user} onChange={e => setFilters(f => ({ ...f, user: e.target.value }))}>
              <option value="">{COPY.allPeople}</option>
              {users.map(user => <option key={user.id} value={user.id}>{user.displayUsername || user.username || user.name}</option>)}
            </select>
            <select aria-label={COPY.allDivesFilter} className={select} value={filters.dive} onChange={e => setFilters(f => ({ ...f, dive: e.target.value }))}>
              <option value="">{COPY.allDivesFilter}</option>
              {dives.map(dive => <option key={dive.key} value={dive.key}>{dive.title}</option>)}
            </select>
          </div>
          <div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-8" aria-label={COPY.search} placeholder={COPY.search} value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} /></div>
        </CardHeader>
        <CardContent>
          <Notice message={state.error && fill(COPY.failed, { reason: state.error })} tone="error" />
          {!state.loading && !items.length && !state.error && <p className="text-sm text-muted-foreground">{COPY.noConversations}</p>}
          <ul className="grid">
            {items.map(item => (
              <li key={item.id}>
                <button type="button" onClick={() => setSelected(item.id)} className={`grid w-full gap-0.5 border-b border-border px-1 py-2 text-left last:border-b-0 hover:bg-muted ${selected === item.id ? "bg-muted" : ""}`}>
                  <span className="truncate text-sm font-medium">{item.title || "—"}</span>
                  <span className="text-xs text-muted-foreground">{item.user_label} · {item.dive_key} · {plural(COPY.messages, Number(item.message_count))}{item.model_tiers ? ` · ${item.model_tiers}` : ""} · {dateTime(item.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
          {state.loading && <Spinner />}
          {state.more && !state.loading && <Button size="sm" variant="ghost" onClick={() => load(items.length)}>{COPY.loadMore}</Button>}
        </CardContent>
      </Card>
      <Card className="min-w-0"><CardContent className="pt-6">{selected ? <ConversationDetail id={selected} onDeleted={() => { setSelected(null); load(0); }} /> : <p className="text-sm text-muted-foreground">{COPY.pick}</p>}</CardContent></Card>
    </div>
  );
}

export default function AdminApp() {
  const [status, setStatus] = React.useState({ state: "loading" });
  const [tab, setTab] = React.useState("users");
  const [users, setUsers] = React.useState([]);
  const [dives, setDives] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    try { document.documentElement.classList.toggle("dark", window.localStorage.getItem("dive_app_theme") === "\"dark\"" || window.localStorage.getItem("dive_app_theme") === "dark"); } catch { /* theme is optional */ }
    document.title = COPY.title;
  }, []);

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await unwrap(authClient.admin.listUsers({ query: { limit: 200, sortBy: "createdAt", sortDirection: "desc" } }));
      setUsers(data.users || []);
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const auth = await api("/api/auth");
        if (auth.mode !== "accounts") return setStatus({ state: "off" });
        if (!auth.authenticated) return setStatus({ state: "signin" });
        if (!auth.user?.isAdmin) return setStatus({ state: "forbidden" });
        const [{ dives: list }, session] = await Promise.all([api("/api/dives"), unwrap(authClient.getSession())]);
        setDives(list || []);
        await loadUsers();
        setStatus({ state: "ready", me: session?.user, demo: Boolean(auth.publicDemo) });
      } catch (error) { setStatus({ state: "error", message: error.message }); }
    })();
  }, [loadUsers]);

  const message = { off: [COPY.accountsOff, COPY.accountsOffBody], signin: [COPY.title, COPY.signIn], forbidden: [COPY.title, COPY.notAdmin], error: [COPY.title, fill(COPY.failed, { reason: status.message })] }[status.state];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button size="sm" variant="ghost" nativeButton={false} render={<a href="/" />}><ArrowLeft data-icon="inline-start" aria-hidden="true" />{COPY.back}</Button>
        <h1 className="text-base font-semibold">{COPY.title}</h1>
        {status.state === "ready" && (
          <nav className="ml-auto flex gap-1" aria-label={COPY.title}>
            <Button size="sm" variant={tab === "users" ? "secondary" : "ghost"} aria-pressed={tab === "users"} onClick={() => setTab("users")}><Users data-icon="inline-start" aria-hidden="true" />{COPY.users}</Button>
            <Button size="sm" variant={tab === "conversations" ? "secondary" : "ghost"} aria-pressed={tab === "conversations"} onClick={() => setTab("conversations")}><MessageSquare data-icon="inline-start" aria-hidden="true" />{COPY.conversations}</Button>
          </nav>
        )}
      </header>
      <ReadOnly.Provider value={status.demo ? COPY.demoUnavailable : ""}>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6">
        {status.state === "loading" && <Spinner />}
        {status.demo && <Card><CardHeader><CardTitle>{COPY.demoTitle}</CardTitle><CardDescription>{COPY.demoBody}</CardDescription></CardHeader></Card>}
        {message && <Card><CardHeader><CardTitle>{message[0]}</CardTitle><CardDescription>{message[1]}</CardDescription></CardHeader>{status.state === "signin" && <CardContent><Button nativeButton={false} render={<a href="/" />}>{COPY.back}</Button></CardContent>}</Card>}
        {status.state === "ready" && tab === "users" && <UsersTab users={users} dives={dives} me={status.me} reload={loadUsers} loading={loading} />}
        {status.state === "ready" && tab === "conversations" && <ConversationsTab users={users} dives={dives} />}
      </main>
      </ReadOnly.Provider>
    </div>
  );
}
