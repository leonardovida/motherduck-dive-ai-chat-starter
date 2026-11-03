import * as React from "react";
import { ArrowLeft, Ban, Check, Copy, Database, Download, KeyRound, Link2, MessageSquare, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserMinus, UserPlus, Users, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { MessageResponse } from "@/components/ai-elements/message";
import { authClient } from "@/lib/auth-client.js";

// All interface text in one place, like the main app.
const COPY = {
  title: "Admin",
  back: "Back to Dives",
  users: "People",
  groups: "Groups",
  motherduck: "MotherDuck access",
  conversations: "Conversations",
  accountsOff: "Accounts are not turned on",
  accountsOffBody: "Set MOTHERDUCK_APP_TOKEN, run npm run db:migrate and create the first admin with npm run admin:create. See docs/accounts.md.",
  signIn: "Sign in as an administrator to open this page.",
  notAdmin: "Only administrators and group managers can open this page.",
  addPeople: "Add people",
  addPeopleBody: "Send each person a one-time setup link and they choose their own password, so no password is ever passed around. Links work once and expire after 7 days.",
  onePerson: "One person",
  pasteList: "Paste a list",
  listLabel: "One person per line: username, display name, email (name and email are optional)",
  listPlaceholder: "maya.chen, Maya Chen, maya@example.com\nsam.okafor, Sam Okafor",
  listEmpty: "Paste at least one person, one per line.",
  username: "Username",
  name: "Display name",
  email: "Email (optional, used to match single sign-on)",
  motherduckUser: "MotherDuck username (optional)",
  motherduckUserHint: "For people who also use MotherDuck. The app then grants them the shares behind their Dives.",
  delivery: "How they sign in the first time",
  deliveryLink: "Setup link (recommended)",
  deliveryPassword: "Password I share myself",
  password: "Password (12+ characters)",
  generate: "Generate",
  role: "Role",
  roles: { user: "Viewer", admin: "Administrator" },
  group: "Group",
  noGroup: "No group",
  groupAccessHint: "People in a group get the group's Dives and chat. Tick anything extra here.",
  managerAddHint: "People you add join {group} and see what the group can open.",
  asManager: "Can manage this group's people",
  access: "Access",
  allDives: "All Dives",
  chat: "AI chat",
  create: "Add",
  creating: "Adding…",
  results: "Added people",
  resultsBody: "Copy each link now and send it through a channel you trust. Links are not shown again; you can create a new one at any time.",
  copy: "Copy",
  copied: "Copied",
  copyAll: "Copy all links",
  downloadCsv: "Download CSV",
  expires: "expires {date}",
  errors: { invalid_username: "use 2-40 letters, digits, dots or underscores", invalid_password: "passwords need 12+ characters", invalid_email: "the email is not valid", already_exists: "that username or email is taken", create_failed: "it could not be created" },
  everyone: "Everyone",
  banned: "Disabled",
  setupLink: "Setup link",
  resetPassword: "Set password",
  save: "Save",
  cancel: "Cancel",
  makeAdmin: "Make admin",
  makeViewer: "Make viewer",
  disable: "Disable",
  enable: "Enable",
  remove: "Delete",
  removeFromGroup: "Remove from {group}",
  confirmRemove: "Confirm delete",
  editAccess: "Edit access",
  fromGroups: "Also from groups: {groups}",
  noUsers: "No people yet.",
  failed: "That did not work: {reason}",
  search: "Search titles",
  filterPeople: "Find people",
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
  newGroup: "New group",
  groupsBody: "A group gives several people the same access: a team, or one of your customers. Give a group a MotherDuck service account and its members see Dives and ask questions as that account, so MotherDuck itself keeps each customer's data apart.",
  groupName: "Name",
  description: "Description (optional)",
  serviceAccount: "MotherDuck service account (optional)",
  serviceAccountHint: "Lowercase letters, digits and underscores. Members open Dives and chat as this account. Leave empty for a team that uses the shared identity.",
  createServiceAccount: "Create it in MotherDuck",
  databases: "Databases for this group",
  databasesHint: "Replace a Dive's database by its alias, for example each customer's own share. Leave empty to use the Dive's own.",
  alias: "Alias",
  url: "md:_share/… or md:database",
  addDatabase: "Add database",
  members: "Members",
  memberCount: ["1 member", "{n} members"],
  manager: "Manager",
  addMember: "Add member",
  pickPerson: "Pick a person",
  noGroups: "No groups yet.",
  dataGroup: "Own data",
  editGroup: "Edit",
  deleteGroup: "Delete group",
  confirmDeleteGroup: "Confirm delete",
  otherDataGroup: "{name} already belongs to {group}, which has its own service account. A person can have one MotherDuck identity.",
  mdTitle: "MotherDuck access",
  mdAutomatic: "Automatic. When access changes here, the app grants or revokes the matching MotherDuck shares in the background, and attaches them for group service accounts. It only removes access it gave.",
  mdManual: "Manual. MOTHERDUCK_ADMIN_TOKEN is not set, so nothing changes in MotherDuck by itself. Run the SQL below as the owner of the shares, or set the token to sync automatically.",
  syncNow: "Sync now",
  syncing: "Syncing…",
  totals: "{synced} synced · {pending} waiting · {failed} failed · {toRemove} to remove",
  grantee: "Who",
  share: "Share",
  state: "State",
  states: { synced: "Synced", pending: "Waiting", failed: "Failed" },
  kinds: { user: "MotherDuck user", service_account: "Service account" },
  noGrants: "Nothing to sync yet. Give a person a MotherDuck username, or a group a service account, and grant a Dive whose data is a share.",
  sqlTitle: "SQL to run",
  mdSynced: "MotherDuck: synced",
  mdPending: "MotherDuck: waiting",
  mdFailed: "MotherDuck: failed",
  demoTitle: "Public demo",
  demoBody: "Every screen is open to explore. Changes are switched off, so the demo stays the same for every visitor.",
  demoTry: ["Open Groups to see how a customer gets its own service account and databases.", "Open Edit access on a person to see how Dives, AI chat and a MotherDuck username are granted.", "Open Conversations to read questions other visitors asked, with the SQL, model and routing reason for each answer."],
  demoUnavailable: "This is not available in a public demo.",
  managerTitle: "Your groups",
  managerBody: "You can add people to {groups}, send them setup links, and disable or remove them. Administrators decide what each group can open.",
};
const fill = (template, values) => String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
const plural = ([one, many], n) => fill(n === 1 ? one : many, { n });
const dateTime = value => (value ? new Date(value).toLocaleString() : "");
const select = "h-9 rounded-md border border-input bg-background px-2 text-sm";

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.error || `HTTP ${response.status}`), { data });
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
const personName = user => user?.displayUsername || user?.username || user?.email || "";

// In a public demo every change stays visible but switched off. The control stays focusable,
// and pressing it says why, so the reason reaches keyboard and touch users, not only on hover.
const ReadOnly = React.createContext({ reason: "", explain: () => {} });
function WriteButton({ disabled, onClick, type, className, ...props }) {
  const { reason, explain } = React.useContext(ReadOnly);
  if (!reason) return <Button type={type} disabled={disabled} onClick={onClick} className={className} {...props} />;
  // A submit button keeps its type, so pressing Enter in the form reaches the form's own check.
  return <Button {...props} type={type} aria-disabled="true" title={reason} className={`opacity-50 ${className || ""}`} onClick={type === "submit" ? undefined : explain} />;
}

function DemoToast({ message }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      {message && <p className="rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">{message}</p>}
    </div>
  );
}

function Notice({ message, tone = "muted" }) {
  if (!message) return null;
  return <p role="status" className={tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message}</p>;
}

function CopyButton({ text, label = COPY.copy, size = "sm", variant = "outline" }) {
  const [done, setDone] = React.useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1500); } catch { /* the text stays selectable */ }
  };
  return <Button type="button" size={size} variant={variant} onClick={copy}>{done ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}{done ? COPY.copied : label}</Button>;
}

function AccessEditor({ dives, value, onChange, legend = COPY.access }) {
  const all = value.dives === "*";
  const toggle = key => {
    const current = all ? [] : value.dives;
    onChange({ ...value, dives: current.includes(key) ? current.filter(item => item !== key) : [...current, key] });
  };
  return (
    <fieldset className="grid gap-2 text-sm">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={() => onChange({ ...value, dives: all ? [] : "*" })} />{COPY.allDives}</label>
      {!all && dives.map(dive => (
        <label key={dive.key} className="flex items-center gap-2 pl-5"><input type="checkbox" checked={value.dives.includes(dive.key)} onChange={() => toggle(dive.key)} />{dive.title}</label>
      ))}
      <label className="flex items-center gap-2"><input type="checkbox" checked={value.chat} onChange={() => onChange({ ...value, chat: !value.chat })} />{COPY.chat}</label>
    </fieldset>
  );
}

// A never-set field (null) still means every Dive; an empty string means none.
const accessOf = user => ({ dives: user.diveAccess == null || user.diveAccess === "*" ? "*" : String(user.diveAccess).split(",").filter(Boolean), chat: user.chatAccess !== false });
const diveSummary = (dives, access) => (access.dives === "*" ? COPY.allDives : dives.filter(dive => access.dives.includes(dive.key)).map(dive => dive.title).join(", ") || "—");
// What a person can actually open: their own access plus every group's, as the server computes it.
const effectiveAccess = (user, memberships) => memberships.reduce((access, { group }) => ({
  dives: access.dives === "*" || group.dives === "*" ? "*" : [...new Set([...access.dives, ...group.dives])],
  chat: access.chat || group.chat,
}), accessOf(user));
const saveAccess = (userId, body) => api(`/api/admin/users/${encodeURIComponent(userId)}/access`, { method: "PATCH", body: JSON.stringify(body) });
// Better Auth changes (role, delete) do not pass through the app's routes, so ask for a sync.
const nudgeSync = () => { fetch("/api/admin/access-sync", { method: "POST", credentials: "same-origin" }).catch(() => {}); };

function parseList(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [username = "", name = "", email = ""] = line.split(/\s*[,;\t]\s*/);
    return { username: username.toLowerCase(), ...(name ? { name } : {}), ...(email ? { email } : {}) };
  });
}

function CreatedPeople({ results, onClose }) {
  const links = results.filter(result => result.setupUrl);
  const csv = ["username,setup_link,expires", ...links.map(result => `${result.username},${result.setupUrl},${result.expiresAt}`)].join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "setup-links.csv" }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="grid gap-3 rounded-md border border-border p-3 md:col-span-2">
      <div><p className="font-medium">{COPY.results}</p><p className="text-sm text-muted-foreground">{COPY.resultsBody}</p></div>
      <ul className="grid gap-2">
        {results.map(result => (
          <li key={result.username} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-28 font-medium">{result.username}</span>
            {result.error ? <span className="text-destructive">{COPY.errors[result.error] || result.error}</span>
              : result.setupUrl ? <><code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{result.setupUrl}</code><CopyButton text={result.setupUrl} /></>
                : <Check className="size-4" aria-label={COPY.copied} />}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {links.length > 1 && <CopyButton text={links.map(result => `${result.username}\t${result.setupUrl}`).join("\n")} label={COPY.copyAll} />}
        {links.length > 0 && <Button type="button" size="sm" variant="outline" onClick={download}><Download data-icon="inline-start" aria-hidden="true" />{COPY.downloadCsv}</Button>}
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>{COPY.cancel}</Button>
      </div>
    </div>
  );
}

function AddPeople({ dives, groups, scope, onCreated }) {
  const admin = scope === "admin";
  const firstGroup = admin ? "" : groups[0]?.id || "";
  const blank = { mode: "one", username: "", name: "", email: "", motherduckUser: "", delivery: "link", password: "", list: "", role: "user", groupId: firstGroup, manager: false, access: firstGroup ? { dives: [], chat: false } : { dives: "*", chat: true } };
  const [form, setForm] = React.useState(blank);
  const [state, setState] = React.useState({ busy: false, message: "", results: null });
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const { reason, explain } = React.useContext(ReadOnly);
  const groupName = groups.find(group => group.id === form.groupId)?.name;
  const chooseGroup = id => setForm(current => ({ ...current, groupId: id, manager: false, access: id ? { dives: [], chat: false } : { dives: "*", chat: true } }));
  const submit = async event => {
    event.preventDefault();
    if (reason) return explain();
    const people = form.mode === "list" ? parseList(form.list)
      : [{ username: form.username.trim().toLowerCase(), name: form.name.trim(), email: form.email.trim(), ...(form.delivery === "password" ? { password: form.password } : {}), ...(admin && form.motherduckUser.trim() ? { motherduckUser: form.motherduckUser.trim() } : {}) }];
    if (!people.length || (form.mode === "one" && form.delivery === "password" && form.password.length < 12)) {
      setState({ busy: false, message: fill(COPY.failed, { reason: form.mode === "list" ? COPY.listEmpty : COPY.errors.invalid_password }), results: null });
      return;
    }
    setState({ busy: true, message: "", results: null });
    try {
      const { results } = await api("/api/admin/people", { method: "POST", body: JSON.stringify({ people, ...(form.groupId ? { groupId: form.groupId } : {}), ...(admin ? { role: form.role, access: form.access, manager: form.manager } : {}) }) });
      setForm(current => ({ ...blank, groupId: current.groupId, access: current.access, mode: current.mode }));
      setState({ busy: false, message: "", results });
      onCreated();
    } catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: error.message }), results: null }); }
  };
  return (
    <Card>
      <CardHeader><CardTitle>{COPY.addPeople}</CardTitle><CardDescription>{COPY.addPeopleBody}</CardDescription></CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
          <div className="flex gap-1 md:col-span-2" role="group" aria-label={COPY.addPeople}>
            {[["one", COPY.onePerson], ["list", COPY.pasteList]].map(([key, label]) => <Button key={key} type="button" size="sm" variant={form.mode === key ? "secondary" : "ghost"} aria-pressed={form.mode === key} onClick={() => set("mode", key)}>{label}</Button>)}
          </div>
          {form.mode === "one" ? (
            <>
              <div className="grid gap-1.5"><Label htmlFor="new-username">{COPY.username}</Label><Input id="new-username" value={form.username} onChange={e => set("username", e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required /></div>
              <div className="grid gap-1.5"><Label htmlFor="new-name">{COPY.name}</Label><Input id="new-name" value={form.name} onChange={e => set("name", e.target.value)} autoComplete="off" /></div>
              <div className="grid gap-1.5"><Label htmlFor="new-email">{COPY.email}</Label><Input id="new-email" type="email" value={form.email} onChange={e => set("email", e.target.value)} autoComplete="off" /></div>
              {admin && <div className="grid gap-1.5"><Label htmlFor="new-md-user">{COPY.motherduckUser}</Label><Input id="new-md-user" value={form.motherduckUser} onChange={e => set("motherduckUser", e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} /><span className="text-xs text-muted-foreground">{COPY.motherduckUserHint}</span></div>}
              <fieldset className="grid gap-2 text-sm md:col-span-2">
                <legend className="mb-1 text-sm font-medium">{COPY.delivery}</legend>
                <label className="flex items-center gap-2"><input type="radio" name="delivery" checked={form.delivery === "link"} onChange={() => set("delivery", "link")} />{COPY.deliveryLink}</label>
                <label className="flex items-center gap-2"><input type="radio" name="delivery" checked={form.delivery === "password"} onChange={() => set("delivery", "password")} />{COPY.deliveryPassword}</label>
                {form.delivery === "password" && (
                  <div className="flex max-w-md gap-2 pl-5"><Input aria-label={COPY.password} placeholder={COPY.password} value={form.password} onChange={e => set("password", e.target.value)} autoComplete="new-password" spellCheck={false} /><Button type="button" variant="outline" onClick={() => set("password", randomPassword())}><KeyRound data-icon="inline-start" aria-hidden="true" />{COPY.generate}</Button></div>
                )}
              </fieldset>
            </>
          ) : (
            <div className="grid gap-1.5 md:col-span-2"><Label htmlFor="new-list">{COPY.listLabel}</Label><Textarea id="new-list" rows={5} value={form.list} onChange={e => set("list", e.target.value)} placeholder={COPY.listPlaceholder} spellCheck={false} className="font-mono text-xs" /></div>
          )}
          <div className="grid content-start gap-1.5">
            <Label htmlFor="new-group">{COPY.group}</Label>
            <select id="new-group" className={select} value={form.groupId} onChange={e => chooseGroup(e.target.value)}>
              {admin && <option value="">{COPY.noGroup}</option>}
              {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            {admin && form.groupId && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.manager} onChange={() => set("manager", !form.manager)} />{COPY.asManager}</label>}
            {!admin && groupName && <span className="text-xs text-muted-foreground">{fill(COPY.managerAddHint, { group: groupName })}</span>}
          </div>
          {admin && (
            <div className="grid content-start gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="new-role">{COPY.role}</Label>
                <select id="new-role" className={select} value={form.role} onChange={e => set("role", e.target.value)}>
                  {Object.entries(COPY.roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>
              <AccessEditor dives={dives} value={form.access} onChange={access => set("access", access)} />
              {form.groupId && <span className="-mt-2 text-xs text-muted-foreground">{COPY.groupAccessHint}</span>}
            </div>
          )}
          <div className="flex items-center gap-3 md:col-span-2">
            <WriteButton type="submit" disabled={state.busy}>{state.busy ? <Spinner data-icon="inline-start" /> : <UserPlus data-icon="inline-start" aria-hidden="true" />}{state.busy ? COPY.creating : COPY.create}</WriteButton>
            <Notice message={state.message} tone="error" />
          </div>
          {state.results && <CreatedPeople results={state.results} onClose={() => setState(current => ({ ...current, results: null }))} />}
        </form>
      </CardContent>
    </Card>
  );
}

function SetupLink({ link }) {
  if (!link) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{link.setupUrl}</code>
      <CopyButton text={link.setupUrl} />
      <span className="text-xs text-muted-foreground">{fill(COPY.expires, { date: dateTime(link.expiresAt) })}</span>
    </div>
  );
}

function syncBadge(user, grants, groups) {
  const dataGroup = (user.groups || []).map(item => groups.find(group => group.id === item.id)).find(group => group?.serviceAccount);
  const grantee = dataGroup?.serviceAccount || user.motherduckUser;
  const rows = grantee ? grants.filter(row => row.grantee === grantee) : [];
  if (!rows.length) return null;
  if (rows.some(row => row.state === "failed")) return <Badge variant="destructive">{COPY.mdFailed}</Badge>;
  if (rows.some(row => row.state === "pending")) return <Badge variant="outline">{COPY.mdPending}</Badge>;
  return <Badge variant="outline">{COPY.mdSynced}</Badge>;
}

function UserRow({ user, dives, groups, grants, scope, self, onChanged }) {
  const admin = scope === "admin";
  const { reason, explain } = React.useContext(ReadOnly);
  const [mode, setMode] = React.useState(null);
  const [password, setPassword] = React.useState("");
  const [access, setAccess] = React.useState(accessOf(user));
  const [mdUser, setMdUser] = React.useState(user.motherduckUser || "");
  const [link, setLink] = React.useState(null);
  const [state, setState] = React.useState({ busy: false, message: "" });
  const isAdmin = String(user.role).split(",").includes("admin");
  const memberships = (user.groups || []).map(item => ({ ...item, group: groups.find(group => group.id === item.id) })).filter(item => item.group);
  const run = async (action, after) => {
    setState({ busy: true, message: "" });
    try { await action(); setMode(null); setPassword(""); setState({ busy: false, message: "" }); after?.(); onChanged(); }
    catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: error.message }) }); }
  };
  const newLink = async () => {
    if (reason) return explain();
    setState({ busy: true, message: "" });
    try { setLink(await api(`/api/admin/users/${encodeURIComponent(user.id)}/setup-link`, { method: "POST" })); setState({ busy: false, message: "" }); }
    catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: error.message }) }); }
  };
  const setBanned = banned => run(() => api(`/api/admin/users/${encodeURIComponent(user.id)}/status`, { method: "POST", body: JSON.stringify({ banned }) }));
  return (
    <li className="grid gap-3 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{personName(user)}</span>
        <span className="text-sm text-muted-foreground">{user.name}</span>
        <Badge variant={isAdmin ? "default" : "secondary"}>{isAdmin ? COPY.roles.admin : COPY.roles.user}</Badge>
        {user.banned && <Badge variant="destructive">{COPY.banned}</Badge>}
        {memberships.map(item => <Badge key={item.id} variant="outline">{item.group.name}{item.manager ? ` · ${COPY.manager}` : ""}</Badge>)}
        {admin && syncBadge(user, grants, groups)}
        {admin && <span className="text-xs text-muted-foreground">{diveSummary(dives, effectiveAccess(user, memberships))} · {COPY.chat} {effectiveAccess(user, memberships).chat ? "✓" : "✗"}{user.motherduckUser ? ` · ${user.motherduckUser}` : ""}</span>}
        <span className="ml-auto flex flex-wrap gap-1">
          <WriteButton size="sm" variant="ghost" disabled={state.busy} onClick={newLink}><Link2 data-icon="inline-start" aria-hidden="true" />{COPY.setupLink}</WriteButton>
          {admin && <Button size="sm" variant="ghost" onClick={() => setMode(mode === "password" ? null : "password")}><KeyRound data-icon="inline-start" aria-hidden="true" />{COPY.resetPassword}</Button>}
          {admin && <Button size="sm" variant="ghost" onClick={() => setMode(mode === "access" ? null : "access")}>{COPY.editAccess}</Button>}
          {admin && !self && <WriteButton size="sm" variant="ghost" disabled={state.busy} onClick={() => run(() => unwrap(authClient.admin.setRole({ userId: user.id, role: isAdmin ? "user" : "admin" })), nudgeSync)}><ShieldCheck data-icon="inline-start" aria-hidden="true" />{isAdmin ? COPY.makeViewer : COPY.makeAdmin}</WriteButton>}
          {!self && <WriteButton size="sm" variant="ghost" disabled={state.busy} onClick={() => setBanned(!user.banned)}>{user.banned ? <Check data-icon="inline-start" aria-hidden="true" /> : <Ban data-icon="inline-start" aria-hidden="true" />}{user.banned ? COPY.enable : COPY.disable}</WriteButton>}
          {!admin && !self && memberships.map(item => (
            <WriteButton key={item.id} size="sm" variant="ghost" disabled={state.busy} onClick={() => run(() => api(`/api/admin/groups/${encodeURIComponent(item.id)}/members?user=${encodeURIComponent(user.id)}`, { method: "DELETE" }))}><UserMinus data-icon="inline-start" aria-hidden="true" />{fill(COPY.removeFromGroup, { group: item.group.name })}</WriteButton>
          ))}
          {admin && !self && (mode === "remove"
            ? <Button size="sm" variant="destructive" disabled={state.busy} onClick={() => run(() => unwrap(authClient.admin.removeUser({ userId: user.id })), nudgeSync)}><Trash2 data-icon="inline-start" aria-hidden="true" />{COPY.confirmRemove}</Button>
            : <WriteButton size="sm" variant="ghost" onClick={() => setMode("remove")}><Trash2 data-icon="inline-start" aria-hidden="true" />{COPY.remove}</WriteButton>)}
        </span>
      </div>
      <SetupLink link={link} />
      {mode === "password" && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (reason) explain(); else if (password.length >= 12) run(() => unwrap(authClient.admin.setUserPassword({ userId: user.id, newPassword: password }))); }}>
          <Input className="max-w-xs" aria-label={COPY.password} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" spellCheck={false} placeholder={COPY.password} />
          <Button type="button" variant="outline" size="sm" onClick={() => setPassword(randomPassword())}>{COPY.generate}</Button>
          <WriteButton type="submit" size="sm" disabled={state.busy || password.length < 12}>{COPY.save}</WriteButton>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>{COPY.cancel}</Button>
        </form>
      )}
      {mode === "access" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid content-start gap-2">
            <AccessEditor dives={dives} value={access} onChange={setAccess} />
            {memberships.length > 0 && <span className="text-xs text-muted-foreground">{fill(COPY.fromGroups, { groups: memberships.map(item => `${item.group.name} (${diveSummary(dives, item.group)})`).join(", ") })}</span>}
          </div>
          <div className="grid content-start gap-1.5"><Label htmlFor={`md-${user.id}`}>{COPY.motherduckUser}</Label><Input id={`md-${user.id}`} value={mdUser} onChange={e => setMdUser(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} /><span className="text-xs text-muted-foreground">{COPY.motherduckUserHint}</span></div>
          <div className="flex gap-2 md:col-span-2"><WriteButton size="sm" disabled={state.busy} onClick={() => run(() => saveAccess(user.id, { ...access, motherduckUser: mdUser.trim() }))}>{COPY.save}</WriteButton><Button size="sm" variant="ghost" onClick={() => { setAccess(accessOf(user)); setMdUser(user.motherduckUser || ""); setMode(null); }}>{COPY.cancel}</Button></div>
        </div>
      )}
      <Notice message={state.message} tone="error" />
    </li>
  );
}

function UsersTab({ data, grants, reload, loading }) {
  const [filter, setFilter] = React.useState("");
  const managed = data.groups.map(group => group.name).join(", ");
  const needle = filter.trim().toLowerCase();
  const users = needle ? data.users.filter(user => [personName(user), user.name, user.email, user.motherduckUser].some(value => String(value ?? "").toLowerCase().includes(needle))) : data.users;
  return (
    <div className="grid gap-6">
      {data.scope === "manager" && <Card><CardHeader><CardTitle>{COPY.managerTitle}</CardTitle><CardDescription>{fill(COPY.managerBody, { groups: managed })}</CardDescription></CardHeader></Card>}
      <AddPeople dives={data.dives} groups={data.groups} scope={data.scope} onCreated={reload} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{COPY.users}</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" aria-hidden="true" /><Input className="h-9 w-48 pl-8" aria-label={COPY.filterPeople} placeholder={COPY.filterPeople} value={filter} onChange={e => setFilter(e.target.value)} /></div>
            <Button size="sm" variant="ghost" onClick={reload} disabled={loading}><RefreshCw data-icon="inline-start" aria-hidden="true" />{COPY.refresh}</Button>
          </div>
        </CardHeader>
        <CardContent>
          {users.length ? <ul className="grid">{users.map(user => <UserRow key={`${user.id}:${user.updatedAt}:${user.banned}:${(user.groups || []).length}`} user={user} dives={data.dives} groups={data.groups} grants={grants} scope={data.scope} self={user.id === data.me} onChanged={reload} />)}</ul> : <p className="text-sm text-muted-foreground">{COPY.noUsers}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function ResourceEditor({ dives, value, onChange }) {
  const set = (key, list) => onChange({ ...value, [key]: list });
  return (
    <fieldset className="grid gap-3 text-sm md:col-span-2">
      <legend className="mb-1 text-sm font-medium">{COPY.databases}</legend>
      <span className="-mt-1 text-xs text-muted-foreground">{COPY.databasesHint}</span>
      {dives.map(dive => {
        const list = value[dive.key] || [];
        return (
          <div key={dive.key} className="grid gap-2 rounded-md border border-border p-2">
            <span className="font-medium">{dive.title}</span>
            {list.map((item, index) => (
              <div key={index} className="flex flex-wrap gap-2">
                <Input className="w-32" aria-label={COPY.alias} placeholder={COPY.alias} value={item.alias} onChange={e => set(dive.key, list.map((entry, i) => (i === index ? { ...entry, alias: e.target.value } : entry)))} spellCheck={false} />
                <Input className="min-w-48 flex-1 font-mono text-xs" aria-label={COPY.url} placeholder={COPY.url} value={item.url} onChange={e => set(dive.key, list.map((entry, i) => (i === index ? { ...entry, url: e.target.value } : entry)))} spellCheck={false} />
                <Button type="button" size="sm" variant="ghost" aria-label={COPY.remove} onClick={() => set(dive.key, list.filter((_, i) => i !== index))}><Trash2 aria-hidden="true" /></Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => set(dive.key, [...list, { alias: "", url: "" }])}><Plus data-icon="inline-start" aria-hidden="true" />{COPY.addDatabase}</Button>
          </div>
        );
      })}
    </fieldset>
  );
}

function GroupForm({ dives, group, mdAutomatic, onSaved, onCancel }) {
  const [form, setForm] = React.useState(() => ({ name: group?.name || "", description: group?.description || "", access: group ? { dives: group.dives, chat: group.chat } : { dives: [], chat: true }, serviceAccount: group?.serviceAccount || "", resources: group?.resources || {} }));
  const [state, setState] = React.useState({ busy: false, message: "", tone: "error" });
  const { reason, explain } = React.useContext(ReadOnly);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const granted = form.access.dives === "*" ? dives : dives.filter(dive => form.access.dives.includes(dive.key));
  const body = () => JSON.stringify({ name: form.name, description: form.description, dives: form.access.dives, chat: form.access.chat, serviceAccount: form.serviceAccount.trim(),
    resources: Object.fromEntries(Object.entries(form.resources).map(([key, list]) => [key, list.filter(item => item.alias.trim() && item.url.trim()).map(item => ({ alias: item.alias.trim(), url: item.url.trim() }))])) });
  const submit = async event => {
    event.preventDefault();
    if (reason) return explain();
    setState({ busy: true, message: "", tone: "error" });
    try {
      if (group) await api(`/api/admin/groups/${encodeURIComponent(group.id)}`, { method: "PATCH", body: body() });
      else await api("/api/admin/groups", { method: "POST", body: body() });
      setState({ busy: false, message: "", tone: "error" });
      onSaved();
    } catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: error.message }), tone: "error" }); }
  };
  const createAccount = async () => {
    if (reason) return explain();
    setState({ busy: true, message: "", tone: "muted" });
    try { await api(`/api/admin/groups/${encodeURIComponent(group.id)}/service-account`, { method: "POST" }); setState({ busy: false, message: COPY.copied, tone: "muted" }); onSaved(); }
    catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: error.data?.detail || error.message }), tone: "error" }); }
  };
  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
      <div className="grid gap-1.5"><Label htmlFor="group-name">{COPY.groupName}</Label><Input id="group-name" value={form.name} onChange={e => set("name", e.target.value)} required /></div>
      <div className="grid gap-1.5"><Label htmlFor="group-description">{COPY.description}</Label><Input id="group-description" value={form.description} onChange={e => set("description", e.target.value)} /></div>
      <AccessEditor dives={dives} value={form.access} onChange={access => set("access", access)} />
      <div className="grid content-start gap-1.5">
        <Label htmlFor="group-sa">{COPY.serviceAccount}</Label>
        <div className="flex flex-wrap gap-2">
          <Input id="group-sa" className="min-w-48 flex-1 font-mono text-xs" value={form.serviceAccount} onChange={e => set("serviceAccount", e.target.value.toLowerCase())} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          {group?.serviceAccount && mdAutomatic && <WriteButton type="button" size="sm" variant="outline" disabled={state.busy} onClick={createAccount}><Database data-icon="inline-start" aria-hidden="true" />{COPY.createServiceAccount}</WriteButton>}
        </div>
        <span className="text-xs text-muted-foreground">{COPY.serviceAccountHint}</span>
      </div>
      {form.serviceAccount.trim() && granted.length > 0 && <ResourceEditor dives={granted} value={form.resources} onChange={resources => set("resources", resources)} />}
      <div className="flex items-center gap-2 md:col-span-2">
        <WriteButton type="submit" size="sm" disabled={state.busy || !form.name.trim()}>{state.busy ? <Spinner data-icon="inline-start" /> : null}{COPY.save}</WriteButton>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{COPY.cancel}</Button>
        <Notice message={state.message} tone={state.tone} />
      </div>
    </form>
  );
}

function GroupMembers({ group, users, onChanged }) {
  const [pick, setPick] = React.useState({ userId: "", manager: false });
  const [message, setMessage] = React.useState("");
  const { reason, explain } = React.useContext(ReadOnly);
  const members = users.filter(user => (user.groups || []).some(item => item.id === group.id));
  const others = users.filter(user => !members.includes(user));
  const change = async (userId, manager, method = "PUT") => {
    if (reason) return explain();
    setMessage("");
    try {
      if (method === "PUT") await api(`/api/admin/groups/${encodeURIComponent(group.id)}/members`, { method, body: JSON.stringify({ userId, manager }) });
      else await api(`/api/admin/groups/${encodeURIComponent(group.id)}/members?user=${encodeURIComponent(userId)}`, { method });
      setPick({ userId: "", manager: false });
      onChanged();
    } catch (error) {
      const person = personName(users.find(user => user.id === userId));
      setMessage(error.message === "other_data_group" ? fill(COPY.otherDataGroup, { name: person, group: error.data?.group }) : fill(COPY.failed, { reason: error.message }));
    }
  };
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{COPY.members}</p>
      <ul className="grid gap-1">
        {members.map(user => {
          const manager = user.groups.find(item => item.id === group.id)?.manager;
          return (
            <li key={user.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-28 font-medium">{personName(user)}</span>
              <label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={Boolean(manager)} onChange={() => change(user.id, !manager)} />{COPY.manager}</label>
              <WriteButton size="sm" variant="ghost" onClick={() => change(user.id, false, "DELETE")}><UserMinus data-icon="inline-start" aria-hidden="true" />{fill(COPY.removeFromGroup, { group: group.name })}</WriteButton>
            </li>
          );
        })}
      </ul>
      <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (pick.userId) change(pick.userId, pick.manager); }}>
        <select aria-label={COPY.pickPerson} className={select} value={pick.userId} onChange={e => setPick(current => ({ ...current, userId: e.target.value }))}>
          <option value="">{COPY.pickPerson}</option>
          {others.map(user => <option key={user.id} value={user.id}>{personName(user)}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={pick.manager} onChange={() => setPick(current => ({ ...current, manager: !current.manager }))} />{COPY.manager}</label>
        <WriteButton type="submit" size="sm" variant="outline" disabled={!pick.userId && !reason}><UserPlus data-icon="inline-start" aria-hidden="true" />{COPY.addMember}</WriteButton>
      </form>
      <Notice message={message} tone="error" />
    </div>
  );
}

function GroupsTab({ data, mdAutomatic, reload }) {
  const [editing, setEditing] = React.useState(null);
  const [confirming, setConfirming] = React.useState(null);
  const [message, setMessage] = React.useState("");
  const saved = () => { setEditing(null); reload(); };
  const remove = async id => {
    try { await api(`/api/admin/groups/${encodeURIComponent(id)}`, { method: "DELETE" }); setConfirming(null); reload(); }
    catch (error) { setMessage(fill(COPY.failed, { reason: error.message })); }
  };
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div className="grid max-w-3xl gap-1.5"><CardTitle>{COPY.groups}</CardTitle><CardDescription>{COPY.groupsBody}</CardDescription></div>
          {editing !== "new" && <Button size="sm" onClick={() => setEditing("new")}><Plus data-icon="inline-start" aria-hidden="true" />{COPY.newGroup}</Button>}
        </CardHeader>
        {editing === "new" && <CardContent><GroupForm dives={data.dives} mdAutomatic={mdAutomatic} onSaved={saved} onCancel={() => setEditing(null)} /></CardContent>}
      </Card>
      <Notice message={message} tone="error" />
      {!data.groups.length && <p className="text-sm text-muted-foreground">{COPY.noGroups}</p>}
      {data.groups.map(group => (
        <Card key={`${group.id}:${group.memberCount}`}>
          <CardHeader className="flex flex-row flex-wrap items-start gap-2">
            <div className="mr-auto grid min-w-0 gap-1">
              <CardTitle className="flex flex-wrap items-center gap-2">{group.name}{group.serviceAccount && <Badge variant="outline"><Database aria-hidden="true" />{COPY.dataGroup}</Badge>}</CardTitle>
              <CardDescription>{[group.description, `${diveSummary(data.dives, group)} · ${COPY.chat} ${group.chat ? "✓" : "✗"}`, plural(COPY.memberCount, group.memberCount ?? 0), group.serviceAccount].filter(Boolean).join(" · ")}</CardDescription>
            </div>
            <span className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(editing === group.id ? null : group.id)}><Pencil data-icon="inline-start" aria-hidden="true" />{COPY.editGroup}</Button>
              {confirming === group.id
                ? <Button size="sm" variant="destructive" onClick={() => remove(group.id)}><Trash2 data-icon="inline-start" aria-hidden="true" />{COPY.confirmDeleteGroup}</Button>
                : <WriteButton size="sm" variant="ghost" onClick={() => setConfirming(group.id)}><Trash2 data-icon="inline-start" aria-hidden="true" />{COPY.deleteGroup}</WriteButton>}
            </span>
          </CardHeader>
          <CardContent className="grid gap-4">
            {editing === group.id && <GroupForm dives={data.dives} group={group} mdAutomatic={mdAutomatic} onSaved={saved} onCancel={() => setEditing(null)} />}
            <GroupMembers group={group} users={data.users} onChanged={reload} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AccessSyncTab({ status, reload }) {
  const [state, setState] = React.useState({ busy: false, message: "" });
  const { reason, explain } = React.useContext(ReadOnly);
  const sync = async () => {
    if (reason) return explain();
    setState({ busy: true, message: "" });
    try { await api("/api/admin/access-sync", { method: "POST" }); setState({ busy: false, message: "" }); reload(); }
    catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: error.message }) }); }
  };
  if (!status) return <Spinner />;
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div className="grid max-w-3xl gap-1.5"><CardTitle>{COPY.mdTitle}</CardTitle><CardDescription>{status.mode === "automatic" ? COPY.mdAutomatic : COPY.mdManual}</CardDescription></div>
          <span className="flex gap-1">
            <WriteButton size="sm" disabled={state.busy} onClick={sync}>{state.busy ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" aria-hidden="true" />}{state.busy ? COPY.syncing : COPY.syncNow}</WriteButton>
          </span>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm">{fill(COPY.totals, status.totals)}</p>
          <Notice message={state.message} tone="error" />
          {status.grants.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground"><tr><th className="py-1 pr-3 font-medium">{COPY.grantee}</th><th className="py-1 pr-3 font-medium">{COPY.share}</th><th className="py-1 pr-3 font-medium">{COPY.alias}</th><th className="py-1 font-medium">{COPY.state}</th></tr></thead>
                <tbody>
                  {status.grants.map(row => (
                    <tr key={`${row.grantee}:${row.url}`} className="border-t border-border align-top">
                      <td className="py-2 pr-3"><span className="font-medium">{row.grantee}</span><br /><span className="text-xs text-muted-foreground">{COPY.kinds[row.kind] || row.kind}</span></td>
                      <td className="py-2 pr-3"><span className="font-mono text-xs">{row.share || row.url}</span></td>
                      <td className="py-2 pr-3 font-mono text-xs">{row.alias}</td>
                      <td className="py-2"><Badge variant={row.state === "failed" ? "destructive" : "outline"}>{COPY.states[row.state] || row.state}</Badge>{row.detail && row.state !== "pending" && <p className="mt-1 max-w-md text-xs text-muted-foreground">{row.detail}</p>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted-foreground">{COPY.noGrants}</p>}
        </CardContent>
      </Card>
      {status.sql && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between"><CardTitle>{COPY.sqlTitle}</CardTitle><CopyButton text={status.sql} /></CardHeader>
          <CardContent><pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{status.sql}</pre></CardContent>
        </Card>
      )}
    </div>
  );
}

function ConversationDetail({ id, diveTitle, onDeleted }) {
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
        <div className="mr-auto min-w-0"><h3 className="font-medium">{conversation.title}</h3><p className="text-xs text-muted-foreground">{conversation.user_label} · {diveTitle(conversation.dive_key)} · {dateTime(conversation.created_at)}</p></div>
        <span className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={exportJson}><Download data-icon="inline-start" aria-hidden="true" />{COPY.exportJson}</Button>
          {confirming
            ? <Button size="sm" variant="destructive" onClick={remove}><Trash2 data-icon="inline-start" aria-hidden="true" />{COPY.confirmRemove}</Button>
            : <WriteButton size="sm" variant="ghost" onClick={() => setConfirming(true)}><Trash2 data-icon="inline-start" aria-hidden="true" />{COPY.remove}</WriteButton>}
        </span>
      </div>
      <ol className="grid gap-3">
        {conversation.messages.map(message => (
          <li key={message.id} className={message.role === "user" ? "rounded-md bg-muted px-3 py-2" : "rounded-md border border-border px-3 py-2"}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{message.role === "user" ? COPY.question : COPY.answer} · {dateTime(message.created_at)}</p>
            {/* Answers render as the person saw them in the chat; questions stay plain text. */}
            {message.role === "assistant" ? <MessageResponse className="h-auto text-sm">{message.content}</MessageResponse> : <p className="whitespace-pre-wrap text-sm">{message.content}</p>}
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
  const detailRef = React.useRef(null);
  const diveTitle = key => dives.find(dive => dive.key === key)?.title || key;
  const open = id => {
    setSelected(id);
    // On narrow screens the detail sits below the list, so bring it into view.
    if (window.matchMedia("(max-width: 1023px)").matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
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
                <button type="button" onClick={() => open(item.id)} aria-current={selected === item.id || undefined} className={`grid w-full gap-0.5 border-b border-border px-1 py-2 text-left last:border-b-0 hover:bg-muted ${selected === item.id ? "bg-muted" : ""}`}>
                  <span className="truncate text-sm font-medium">{item.title || "—"}</span>
                  <span className="text-xs text-muted-foreground">{item.user_label} · {diveTitle(item.dive_key)} · {plural(COPY.messages, Number(item.message_count))}{item.model_tiers ? ` · ${item.model_tiers}` : ""} · {dateTime(item.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
          {state.loading && <Spinner />}
          {state.more && !state.loading && <Button size="sm" variant="ghost" onClick={() => load(items.length)}>{COPY.loadMore}</Button>}
        </CardContent>
      </Card>
      <Card className="min-w-0 scroll-mt-4" ref={detailRef}><CardContent className="pt-6">{selected ? <ConversationDetail id={selected} diveTitle={diveTitle} onDeleted={() => { setSelected(null); load(0); }} /> : <p className="text-sm text-muted-foreground">{COPY.pick}</p>}</CardContent></Card>
    </div>
  );
}

export default function AdminApp() {
  const [status, setStatus] = React.useState({ state: "loading" });
  const [tab, setTab] = React.useState("users");
  const [data, setData] = React.useState({ users: [], groups: [], dives: [], scope: "admin", me: null });
  const [sync, setSync] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [toast, setToast] = React.useState("");
  const toastTimer = React.useRef();
  const readOnly = React.useMemo(() => ({
    reason: status.demo ? COPY.demoUnavailable : "",
    explain: () => {
      setToast(COPY.demoUnavailable);
      window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(""), 3500);
    },
  }), [status.demo]);

  React.useEffect(() => {
    try { document.documentElement.classList.toggle("dark", window.localStorage.getItem("dive_app_theme") === "\"dark\"" || window.localStorage.getItem("dive_app_theme") === "dark"); } catch { /* theme is optional */ }
    document.title = COPY.title;
  }, []);

  const loadSync = React.useCallback(async () => {
    try { setSync(await api("/api/admin/access-sync")); } catch { setSync(null); }
  }, []);
  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const people = await api("/api/admin/people");
      setData(people);
      if (people.scope === "admin") await loadSync();
      return people;
    } finally { setLoading(false); }
  }, [loadSync]);

  React.useEffect(() => {
    (async () => {
      try {
        const auth = await api("/api/auth");
        if (auth.mode !== "accounts") return setStatus({ state: "off" });
        if (!auth.authenticated) return setStatus({ state: "signin" });
        if (!auth.user?.canManage) return setStatus({ state: "forbidden" });
        await load();
        setStatus({ state: "ready", demo: Boolean(auth.publicDemo) });
      } catch (error) { setStatus({ state: "error", message: error.message }); }
    })();
  }, [load]);

  const admin = data.scope === "admin";
  const tabs = [["users", COPY.users, Users], ...(admin ? [["groups", COPY.groups, UsersRound], ["motherduck", COPY.motherduck, Database], ["conversations", COPY.conversations, MessageSquare]] : [])];
  const message = { off: [COPY.accountsOff, COPY.accountsOffBody], signin: [COPY.title, COPY.signIn], forbidden: [COPY.title, COPY.notAdmin], error: [COPY.title, fill(COPY.failed, { reason: status.message })] }[status.state];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <Button size="sm" variant="ghost" nativeButton={false} render={<a href="/" />}><ArrowLeft data-icon="inline-start" aria-hidden="true" />{COPY.back}</Button>
        <h1 className="text-base font-semibold">{COPY.title}</h1>
        {status.state === "ready" && (
          <nav className="flex w-full flex-wrap gap-1 sm:ml-auto sm:w-auto" aria-label={COPY.title}>
            {tabs.map(([key, label, Icon]) => <Button key={key} size="sm" variant={tab === key ? "secondary" : "ghost"} aria-pressed={tab === key} onClick={() => { setTab(key); if (key === "motherduck") loadSync(); }}><Icon data-icon="inline-start" aria-hidden="true" />{label}</Button>)}
          </nav>
        )}
      </header>
      <ReadOnly.Provider value={readOnly}>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6">
        {status.state === "loading" && <Spinner />}
        {status.demo && (
          <Card>
            <CardHeader><CardTitle>{COPY.demoTitle}</CardTitle><CardDescription>{COPY.demoBody}</CardDescription></CardHeader>
            <CardContent><ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">{COPY.demoTry.map(item => <li key={item}>{item}</li>)}</ul></CardContent>
          </Card>
        )}
        {message && <Card><CardHeader><CardTitle>{message[0]}</CardTitle><CardDescription>{message[1]}</CardDescription></CardHeader>{status.state === "signin" && <CardContent><Button nativeButton={false} render={<a href="/" />}>{COPY.back}</Button></CardContent>}</Card>}
        {status.state === "ready" && tab === "users" && <UsersTab data={data} grants={sync?.grants || []} reload={load} loading={loading} />}
        {status.state === "ready" && admin && tab === "groups" && <GroupsTab data={data} mdAutomatic={sync?.mode === "automatic"} reload={load} />}
        {status.state === "ready" && admin && tab === "motherduck" && <AccessSyncTab status={sync} reload={loadSync} />}
        {status.state === "ready" && admin && tab === "conversations" && <ConversationsTab users={data.users} dives={data.dives} />}
      </main>
      <DemoToast message={toast} />
      </ReadOnly.Provider>
    </div>
  );
}
