import * as React from "react";
import { ArrowLeft, Ban, Bot, ChartColumn, Check, CheckCheck, Copy, Database, Download, History, KeyRound, Link2, MessageSquare, Pencil, Plus, RefreshCw, Search, ShieldCheck, ThumbsDown, ThumbsUp, Trash2, UserMinus, UserPlus, Users, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { MessageResponse } from "@/components/ai-elements/message";
import { authClient } from "@/lib/auth-client.js";
import { api } from "@/lib/api.mjs";
import { downloadBlob } from "@/lib/download.mjs";
import { FEEDBACK_REASONS, MIN_PASSWORD_LENGTH, fill, plural } from "@/lib/text.mjs";
import { useLatestRequest } from "@/hooks/use-latest-request";
import ModelsTab from "./ModelsTab.jsx";

// All interface text in one place, like the main app.
const COPY = {
  title: "Admin",
  back: "Back to Dives",
  users: "People",
  groups: "Groups",
  motherduck: "MotherDuck access",
  conversations: "Conversations",
  questions: "Questions",
  activity: "Activity",
  models: "Models",
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
  listTooLong: "Paste at most {max} people at a time. This list has {n}.",
  listCount: ["1 person", "{n} people"],
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
  passwordGiven: "Added with the password you chose",
  // Server error codes, in words. Anything unknown is shown as its code.
  reasons: {
    invalid_people: "check the list: each line needs a username, and at most {max} people at a time",
    invalid_group: "check the name and databases",
    invalid_access: "check the MotherDuck username",
    invalid_member: "pick a person first",
    service_account_in_use: "another group already uses this service account, and two groups would read each other's data",
    invalid_sync: "refresh the page and try again",
    members_in_other_data_group: "some members already belong to another group with its own service account, and a person can have only one",
    single_sign_on_user: "this person signs in with single sign-on, so only an administrator can create a setup link for them",
    disabled_by_admin: "an administrator disabled this person, so only an administrator can re-enable them",
    group_not_managed: "you can only add people to the groups you manage",
    not_found: "this person or group is no longer there, or is outside your groups. Refresh the page",
    admin_required: "only administrators can do this",
    authentication_required: "your session ended. Sign in again",
    origin_not_allowed: "the request came from another site",
    accounts_unavailable: "the app database did not answer. Try again",
    admin_not_configured: "set MOTHERDUCK_ADMIN_TOKEN first",
    no_service_account: "save a service account name first",
    create_failed: "MotherDuck refused to create it",
    sync_failed: "the sync failed. See the server log",
    automatic_mode: "the app syncs by itself, so there is nothing to mark",
    demo_read_only: "this is not available in a public demo",
    conversations_unavailable: "the app database did not answer. Try again",
    topics_need_model: "grouping into topics needs an AI model to be configured",
    topics_failed: "the AI model could not group the questions. Try again",
    digest_not_configured: "set DIGEST_WEBHOOK_URL first",
    digest_failed: "the webhook did not accept the digest. Check DIGEST_WEBHOOK_URL",
  },
  banned: "Disabled",
  invited: "Invited · link expires {date}",
  inviteExpired: "Invite expired",
  neverSignedIn: "Never signed in",
  lastSignIn: "Last signed in {date}",
  sso: "Single sign-on",
  outOfReach: "Also in other groups or a manager. An administrator looks after this person.",
  truncated: "Showing the newest {max} people. Search narrows this list only.",
  exportPeople: "Export CSV",
  dataGroupDecides: "While {name} is in {group}, that group decides what they can open. Their own access applies again only if they leave it.",
  confirmMakeAdmin: "Confirm: make admin",
  confirmDisable: "Confirm: disable",
  passwordSaved: "Password saved. {name} is signed out everywhere else.",
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
  search: "Search questions",
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
  tool: { getDiveState: "Read the Dive state", listTables: "Listed tables", describeTable: "Described a table", runQuery: "Ran a query" },
  exportJson: "Export JSON",
  needsAttention: "Needs attention",
  needsAttentionFilter: "Only failed, stopped or rated not helpful",
  statuses: { answered: "Answered", failed: "Failed", stopped: "Stopped", unanswered: "No answer saved" },
  helpful: "Rated helpful",
  notHelpful: "Rated not helpful",
  askedFrom: "Groups: {groups}",
  askedWith: "Dive state: {state}",
  topicLabel: "Topic: {topic}",
  topics: "Topics",
  topicsHint: "Questions grouped by subject. Grouping uses the AI model on questions that have no topic yet.",
  groupTopics: "Group into topics",
  groupingTopics: "Grouping…",
  unclassified: ["1 question has no topic yet.", "{n} questions have no topic yet."],
  topicsDone: "Grouped {n} questions.",
  topicsNeedModel: "Grouping into topics needs an AI model to be configured.",
  noTopics: "No topics yet. Select Group into topics.",
  gaps: "Data people asked for but could not get",
  gapsHint: "Answers that said the data needed was not available. Useful when deciding what to add to a Dive.",
  noGaps: "No answer in this period said the data was missing. Questions are checked when they are grouped into topics.",
  tileCost: "Estimated cost",
  tileCostDetail: "from MODEL_PRICES",
  unpriced: "no price for {tiers}",
  sendDigest: "Send digest now",
  digestSent: "The digest was posted.",
  managerQuestions: "Questions asked by members of {groups}. Conversations themselves are visible to administrators only.",
  allowance: "Monthly AI chat allowance in tokens (optional)",
  allowanceHint: "Once the group's members have used this many tokens in a calendar month (UTC), they cannot ask more until the 1st. Administrators are not limited. Needs saved conversations. Leave empty for no limit.",
  allowanceUsed: "AI chat this month: {used} of {cap} tokens",
  allowanceReached: "Allowance used up",
  purgeConversations: "Also delete their saved conversations",
  questionsTitle: "Questions asked in chat",
  questionsBody: "What people ask, how each answer went and how they rated it. Every question is saved in the app database. Query the chat_questions view in MotherDuck for anything this page does not show.",
  periods: [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"], [365, "Last 12 months"]],
  period: "Period",
  allGroups: "All groups",
  noModel: "No answer",
  exportQuestions: "Export CSV",
  noQuestions: "No questions in this period.",
  tileQuestions: "Questions",
  tileQuestionsDetail: "{people} · {conversations}",
  people: ["1 person", "{n} people"],
  conversationCount: ["1 conversation", "{n} conversations"],
  tileAnswered: "Answered",
  tileAnsweredDetail: "{failed} failed · {stopped} stopped · {unanswered} without a saved answer",
  tileFeedback: "Feedback",
  tileFeedbackDetail: "{rated}% of answers rated",
  tileSpeed: "Typical answer time",
  tileSpeedDetail: "median · {tokens} tokens in total",
  perDay: "Questions per day (UTC)",
  dayReadout: "{day}: {questions} · {attention} needing attention",
  periodReadout: "{questions} in this period · {attention} needing attention. Hover a day for its numbers.",
  questionCount: ["1 question", "{n} questions"],
  byDive: "By Dive",
  byGroup: "By group",
  byModel: "By model",
  colName: "Name",
  colQuestions: "Questions",
  colAttention: "Needs attention",
  frequent: "Most asked",
  frequentHint: "Questions that differ only in case, spacing or punctuation count together.",
  askedBy: "{questions} · {people} · last {when}",
  attention: "Needs attention",
  attentionHint: "The newest failed or stopped answers, and answers rated not helpful.",
  noAttention: "Nothing needs attention in this period.",
  openConversation: "Open the conversation",
  loadMore: "Load more",
  refresh: "Refresh",
  newGroup: "New group",
  groupsBody: "A group gives several people the same access: a team, or one of your customers. Give a group a MotherDuck service account and its members see Dives and ask questions as that account, so MotherDuck itself keeps each customer's data apart.",
  groupName: "Name",
  description: "Description (optional)",
  serviceAccount: "MotherDuck service account (optional)",
  serviceAccountHint: "Lowercase letters, digits and underscores. Members open Dives and chat as this account. Leave empty for a team that uses the shared identity.",
  createServiceAccount: "Create it in MotherDuck",
  createServiceAccountNow: "Also create this service account in MotherDuck now",
  serviceAccountCreated: "The service account exists in MotherDuck, and its shares are syncing.",
  chatNotReady: "AI chat off: chat as a service account needs MOTHERDUCK_ADMIN_TOKEN and the Dive's chat database among the group's databases",
  deleteGroupWarning: "Delete {name}? Its {members} lose what the group gives them, and the app removes the MotherDuck access it gave the group.",
  filterMembers: "Find a person to add",
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
  activityTitle: "Activity",
  activityBody: "Who changed what: people, access, groups, MotherDuck grants, deleted conversations and question exports. Passwords, setup links and tokens are never recorded.",
  filterActivity: "Find a person",
  allActions: "All changes",
  noActivity: "No changes recorded yet.",
  actions: {
    "person.created": "Added", "person.access_changed": "Changed access of", "person.disabled": "Disabled", "person.enabled": "Re-enabled",
    "person.setup_link": "Created a setup link for", "person.password_set": "Set the password of", "person.password_chosen": "Chose a password", "person.password_changed": "Changed their password",
    "person.role_changed": "Changed the role of", "person.removed": "Deleted", "person.signed_out": "Signed out", "person.impersonated": "Signed in as", "person.updated": "Changed the details of",
    "group.created": "Created group", "group.updated": "Changed group", "group.deleted": "Deleted group", "group.member_added": "Added to a group",
    "group.member_removed": "Removed from a group", "group.service_account_created": "Created the service account of",
    "access_sync.run": "Synced MotherDuck access", "access_sync.confirmed": "Marked the MotherDuck SQL as done", "conversation.deleted": "Deleted a conversation", "questions.exported": "Exported the chat questions", "questions.classified": "Grouped questions into topics", "questions.digest_sent": "Sent the questions digest",
    "models.updated": "Changed the chat models", "models.reset": "Reset the chat models to the environment",
  },
  grantee: "Who",
  share: "Share",
  state: "State",
  states: { synced: "Synced", pending: "Waiting", failed: "Failed", removing: "Waiting to remove" },
  markDone: "Mark as done",
  markDoneHint: "After running the SQL as the share owner, mark it done: waiting grants count as synced and finished removals leave the list.",
  queued: "Another sync is running. It will include these changes.",
  kinds: { user: "MotherDuck user", service_account: "Service account" },
  noGrants: "Nothing to sync yet. Give a person a MotherDuck username, or a group a service account, and grant a Dive whose data is a share.",
  sqlTitle: "SQL to run",
  mdSynced: "MotherDuck: synced",
  mdPending: "MotherDuck: waiting",
  mdFailed: "MotherDuck: failed",
  demoTitle: "Public demo",
  demoBody: "Every screen is open to explore. Changes are switched off, so the demo stays the same for every visitor.",
  demoTry: ["Open Groups to see how a customer gets its own service account and databases.", "Open Edit access on a person to see how Dives, AI chat and a MotherDuck username are granted.", "Open Conversations to read questions other visitors asked, with the SQL, model and routing reason for each answer.", "Open Questions to see what visitors ask, how each answer went and how they rated it.", "Open Activity to see who changed what."],
  demoUnavailable: "This is not available in a public demo.",
  managerTitle: "Your groups",
  managerBody: "You can add people to {groups}, send them setup links, and disable or remove them. Administrators decide what each group can open.",
  managerGroupAccess: "{group} can open {dives} · {chat}",
  chatOn: "AI chat on",
  chatOff: "no AI chat",
};
const dateTime = value => (value ? new Date(value).toLocaleString() : "");
const select = "h-9 rounded-md border border-input bg-background px-2 text-sm";

// A server error code in words, for "That did not work: …".
const reasonFor = (error, values = {}) => fill(COPY.reasons[error?.message] || error?.message || "", values);
const downloadText = (text, name, type) => downloadBlob(new Blob([text], { type }), name);
// Cells that a spreadsheet would run as a formula (questions are typed by anyone) get a leading quote.
const csvCell = value => { const raw = String(value ?? ""); const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw; return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };

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
  return <p role={tone === "error" ? "alert" : "status"} className={tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message}</p>;
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
// What a person can actually open, as the server computes it: their own access plus every
// group's, except that a group with a service account alone decides for its members.
const dataGroupOf = memberships => memberships.map(item => item.group).filter(group => group.serviceAccount).sort((a, b) => a.id.localeCompare(b.id))[0];
const effectiveAccess = (user, memberships) => {
  const data = dataGroupOf(memberships);
  if (data) return { dives: data.dives, chat: data.chatReady ?? data.chat };
  return memberships.reduce((access, { group }) => ({
    dives: access.dives === "*" || group.dives === "*" ? "*" : [...new Set([...access.dives, ...group.dives])],
    chat: access.chat || group.chat,
  }), accessOf(user));
};
const saveAccess = (userId, body) => api(`/api/admin/users/${encodeURIComponent(userId)}/access`, { method: "PATCH", body: JSON.stringify(body) });

function parseList(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [username = "", name = "", email = ""] = line.split(/\s*[,;\t]\s*/);
    return { username: username.toLowerCase(), ...(name ? { name } : {}), ...(email ? { email } : {}) };
  });
}

function CreatedPeople({ results, onClose }) {
  const links = results.filter(result => result.setupUrl);
  const csv = ["username,setup_link,expires", ...links.map(result => [result.username, result.setupUrl, result.expiresAt].map(csvCell).join(","))].join("\n");
  const download = () => downloadText(csv, "setup-links.csv", "text/csv");
  return (
    <div className="grid gap-3 rounded-md border border-border p-3 md:col-span-2">
      <div><p className="font-medium">{COPY.results}</p><p className="text-sm text-muted-foreground">{COPY.resultsBody}</p></div>
      <ul className="grid gap-2">
        {results.map(result => (
          <li key={result.username} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-28 font-medium">{result.username}</span>
            {result.error ? <span className="text-destructive">{COPY.errors[result.error] || result.error}</span>
              : result.setupUrl ? <><code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{result.setupUrl}</code><CopyButton text={result.setupUrl} /></>
                : <span className="flex items-center gap-1 text-muted-foreground"><Check className="size-4" aria-hidden="true" />{COPY.passwordGiven}</span>}
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

function AddPeople({ dives, groups, scope, maxImport = 200, onCreated }) {
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
    if (!people.length || people.length > maxImport || (form.mode === "one" && form.delivery === "password" && form.password.length < MIN_PASSWORD_LENGTH)) {
      const reason = form.mode === "list" ? (people.length ? fill(COPY.listTooLong, { max: maxImport, n: people.length }) : COPY.listEmpty) : COPY.errors.invalid_password;
      setState({ busy: false, message: fill(COPY.failed, { reason }), results: null });
      return;
    }
    setState({ busy: true, message: "", results: null });
    try {
      const { results } = await api("/api/admin/people", { method: "POST", body: JSON.stringify({ people, ...(form.groupId ? { groupId: form.groupId } : {}), ...(admin ? { role: form.role, access: form.access, manager: form.manager } : {}) }) });
      setForm(current => ({ ...blank, groupId: current.groupId, access: current.access, mode: current.mode }));
      setState({ busy: false, message: "", results });
      onCreated();
    } catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: reasonFor(error, { max: maxImport }) }), results: null }); }
  };
  const pasted = form.mode === "list" ? parseList(form.list).length : 0;
  return (
    <Card>
      <CardHeader><CardTitle role="heading" aria-level={2}>{COPY.addPeople}</CardTitle><CardDescription>{COPY.addPeopleBody}</CardDescription></CardHeader>
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
            <div className="grid gap-1.5 md:col-span-2"><Label htmlFor="new-list">{COPY.listLabel}</Label><Textarea id="new-list" rows={5} value={form.list} onChange={e => set("list", e.target.value)} placeholder={COPY.listPlaceholder} spellCheck={false} className="font-mono text-xs" aria-describedby="new-list-count" /><span id="new-list-count" className={`text-xs ${pasted > maxImport ? "text-destructive" : "text-muted-foreground"}`}>{pasted > maxImport ? fill(COPY.listTooLong, { max: maxImport, n: pasted }) : pasted ? plural(COPY.listCount, pasted) : ""}</span></div>
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
            <Notice message={state.message} tone={state.tone} />
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
  const [purge, setPurge] = React.useState(false);
  const [state, setState] = React.useState({ busy: false, message: "", tone: "error" });
  const isAdmin = String(user.role).split(",").includes("admin");
  const name = personName(user);
  const memberships = (user.groups || []).map(item => ({ ...item, group: groups.find(group => group.id === item.id) })).filter(item => item.group);
  const dataGroup = dataGroupOf(memberships);
  const effective = effectiveAccess(user, memberships);
  // A manager sees people who are also in other groups, but only administrators change them.
  const canAct = admin || user.manageable !== false;
  const run = async (action, done = "") => {
    setState({ busy: true, message: "", tone: "error" });
    try { await action(); setMode(null); setPassword(""); setState({ busy: false, message: done, tone: "muted" }); onChanged(); }
    catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: reasonFor(error) }), tone: "error" }); }
  };
  const newLink = async () => {
    if (reason) return explain();
    setState({ busy: true, message: "", tone: "error" });
    try { setLink(await api(`/api/admin/users/${encodeURIComponent(user.id)}/setup-link`, { method: "POST" })); setState({ busy: false, message: "", tone: "error" }); }
    catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: reasonFor(error) }), tone: "error" }); }
  };
  const setBanned = banned => run(() => api(`/api/admin/users/${encodeURIComponent(user.id)}/status`, { method: "POST", body: JSON.stringify({ banned }) }));
  // Changes that are easy to make by mistake ask once more, in place.
  const confirmFirst = (key, action) => () => { if (reason) return explain(); if (mode === key) action(); else setMode(key); };
  const invite = user.inviteExpiresAt ? (new Date(user.inviteExpiresAt) > new Date() ? fill(COPY.invited, { date: dateTime(user.inviteExpiresAt) }) : COPY.inviteExpired) : "";
  const label = text => `${text}: ${name}`;
  return (
    <li className="grid gap-3 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{name}</span>
        <span className="text-sm text-muted-foreground">{user.name}</span>
        <Badge variant={isAdmin ? "default" : "secondary"}>{isAdmin ? COPY.roles.admin : COPY.roles.user}</Badge>
        {user.banned && <Badge variant="destructive">{COPY.banned}</Badge>}
        {user.sso && <Badge variant="outline">{COPY.sso}</Badge>}
        {memberships.map(item => <Badge key={item.id} variant="outline">{item.group.name}{item.manager ? ` · ${COPY.manager}` : ""}</Badge>)}
        {admin && syncBadge(user, grants, groups)}
        {admin && <span className="text-xs text-muted-foreground">{diveSummary(dives, effective)} · {COPY.chat} {effective.chat ? "✓" : "✗"}{user.motherduckUser ? ` · ${user.motherduckUser}` : ""}</span>}
        <span className="text-xs text-muted-foreground">{[invite, user.lastSignInAt ? fill(COPY.lastSignIn, { date: dateTime(user.lastSignInAt) }) : !invite ? COPY.neverSignedIn : ""].filter(Boolean).join(" · ")}</span>
        {canAct && (
          <span className="ml-auto flex flex-wrap gap-1">
            {(admin || !user.sso) && <WriteButton size="sm" variant="ghost" disabled={state.busy} onClick={newLink} aria-label={label(COPY.setupLink)}><Link2 data-icon="inline-start" aria-hidden="true" />{COPY.setupLink}</WriteButton>}
            {admin && <Button size="sm" variant="ghost" aria-expanded={mode === "password"} aria-label={label(COPY.resetPassword)} onClick={() => setMode(mode === "password" ? null : "password")}><KeyRound data-icon="inline-start" aria-hidden="true" />{COPY.resetPassword}</Button>}
            {admin && <Button size="sm" variant="ghost" aria-expanded={mode === "access"} aria-label={label(COPY.editAccess)} onClick={() => setMode(mode === "access" ? null : "access")}>{COPY.editAccess}</Button>}
            {admin && !self && <WriteButton size="sm" variant={mode === "role" ? "destructive" : "ghost"} disabled={state.busy} aria-label={label(isAdmin ? COPY.makeViewer : mode === "role" ? COPY.confirmMakeAdmin : COPY.makeAdmin)} onClick={isAdmin ? () => (reason ? explain() : run(() => unwrap(authClient.admin.setRole({ userId: user.id, role: "user" })))) : confirmFirst("role", () => run(() => unwrap(authClient.admin.setRole({ userId: user.id, role: "admin" }))))}><ShieldCheck data-icon="inline-start" aria-hidden="true" />{isAdmin ? COPY.makeViewer : mode === "role" ? COPY.confirmMakeAdmin : COPY.makeAdmin}</WriteButton>}
            {!self && (user.banned
              ? <WriteButton size="sm" variant="ghost" disabled={state.busy} aria-label={label(COPY.enable)} onClick={() => (reason ? explain() : setBanned(false))}><Check data-icon="inline-start" aria-hidden="true" />{COPY.enable}</WriteButton>
              : <WriteButton size="sm" variant={mode === "disable" ? "destructive" : "ghost"} disabled={state.busy} aria-label={label(mode === "disable" ? COPY.confirmDisable : COPY.disable)} onClick={confirmFirst("disable", () => setBanned(true))}><Ban data-icon="inline-start" aria-hidden="true" />{mode === "disable" ? COPY.confirmDisable : COPY.disable}</WriteButton>)}
            {!admin && !self && memberships.map(item => (
              <WriteButton key={item.id} size="sm" variant="ghost" disabled={state.busy} aria-label={label(fill(COPY.removeFromGroup, { group: item.group.name }))} onClick={() => (reason ? explain() : run(() => api(`/api/admin/groups/${encodeURIComponent(item.id)}/members?user=${encodeURIComponent(user.id)}`, { method: "DELETE" })))}><UserMinus data-icon="inline-start" aria-hidden="true" />{fill(COPY.removeFromGroup, { group: item.group.name })}</WriteButton>
            ))}
            {admin && !self && <WriteButton size="sm" variant={mode === "remove" ? "destructive" : "ghost"} disabled={state.busy} aria-label={label(mode === "remove" ? COPY.confirmRemove : COPY.remove)} onClick={confirmFirst("remove", () => run(async () => {
              // Conversations go first, so a failure leaves the account in place to try again.
              if (purge) await api(`/api/admin/users/${encodeURIComponent(user.id)}/conversations`, { method: "DELETE" });
              await unwrap(authClient.admin.removeUser({ userId: user.id }));
            }))}><Trash2 data-icon="inline-start" aria-hidden="true" />{mode === "remove" ? COPY.confirmRemove : COPY.remove}</WriteButton>}
            {mode === "remove" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={purge} onChange={e => setPurge(e.target.checked)} />{COPY.purgeConversations}</label>}
            {["role", "disable", "remove"].includes(mode) && <Button size="sm" variant="ghost" onClick={() => setMode(null)}>{COPY.cancel}</Button>}
          </span>
        )}
      </div>
      {!canAct && !self && <p className="text-xs text-muted-foreground">{COPY.outOfReach}</p>}
      <SetupLink link={link} />
      {mode === "password" && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (reason) explain(); else if (password.length >= MIN_PASSWORD_LENGTH) run(() => unwrap(authClient.admin.setUserPassword({ userId: user.id, newPassword: password })), fill(COPY.passwordSaved, { name })); }}>
          <Input className="max-w-xs" aria-label={label(COPY.password)} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" spellCheck={false} placeholder={COPY.password} />
          <Button type="button" variant="outline" size="sm" onClick={() => setPassword(randomPassword())}>{COPY.generate}</Button>
          <WriteButton type="submit" size="sm" disabled={state.busy || password.length < MIN_PASSWORD_LENGTH}>{COPY.save}</WriteButton>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>{COPY.cancel}</Button>
        </form>
      )}
      {mode === "access" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid content-start gap-2">
            {dataGroup && <p className="text-xs text-muted-foreground">{fill(COPY.dataGroupDecides, { name, group: dataGroup.name })}</p>}
            <AccessEditor dives={dives} value={access} onChange={setAccess} />
            {memberships.length > 0 && !dataGroup && <span className="text-xs text-muted-foreground">{fill(COPY.fromGroups, { groups: memberships.map(item => `${item.group.name} (${diveSummary(dives, item.group)})`).join(", ") })}</span>}
          </div>
          <div className="grid content-start gap-1.5"><Label htmlFor={`md-${user.id}`}>{COPY.motherduckUser}</Label><Input id={`md-${user.id}`} value={mdUser} onChange={e => setMdUser(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} /><span className="text-xs text-muted-foreground">{COPY.motherduckUserHint}</span></div>
          <div className="flex gap-2 md:col-span-2"><WriteButton size="sm" disabled={state.busy} onClick={() => (reason ? explain() : run(() => saveAccess(user.id, { ...access, motherduckUser: mdUser.trim() })))}>{COPY.save}</WriteButton><Button size="sm" variant="ghost" onClick={() => { setAccess(accessOf(user)); setMdUser(user.motherduckUser || ""); setMode(null); }}>{COPY.cancel}</Button></div>
        </div>
      )}
      <Notice message={state.message} tone={state.tone} />
    </li>
  );
}

function UsersTab({ data, grants, reload, loading }) {
  const [filter, setFilter] = React.useState("");
  const needle = filter.trim().toLowerCase();
  const groupName = id => data.groups.find(group => group.id === id)?.name || "";
  const users = needle ? data.users.filter(user => [personName(user), user.name, user.email, user.motherduckUser, ...(user.groups || []).map(item => groupName(item.id))].some(value => String(value ?? "").toLowerCase().includes(needle))) : data.users;
  const exportCsv = () => downloadText([
    "username,name,email,role,disabled,groups,motherduck_user,last_signed_in,created",
    ...data.users.map(user => [personName(user), user.name, user.email?.endsWith("@accounts.invalid") ? "" : user.email, user.role, user.banned ? "yes" : "no", (user.groups || []).map(item => `${groupName(item.id)}${item.manager ? " (manager)" : ""}`).join("; "), user.motherduckUser, user.lastSignInAt, user.createdAt].map(csvCell).join(",")),
  ].join("\n"), "people.csv", "text/csv");
  return (
    <div className="grid gap-6">
      {data.scope === "manager" && (
        <Card>
          <CardHeader><CardTitle role="heading" aria-level={2}>{COPY.managerTitle}</CardTitle><CardDescription>{fill(COPY.managerBody, { groups: data.groups.map(group => group.name).join(", ") })}</CardDescription></CardHeader>
          <CardContent><ul className="grid gap-1 text-sm">{data.groups.map(group => <li key={group.id}>{fill(COPY.managerGroupAccess, { group: group.name, dives: diveSummary(data.dives, group), chat: group.chatReady ? COPY.chatOn : COPY.chatOff })}</li>)}</ul></CardContent>
        </Card>
      )}
      <AddPeople dives={data.dives} groups={data.groups} scope={data.scope} maxImport={data.maxImport} onCreated={reload} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle role="heading" aria-level={2}>{COPY.users}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" aria-hidden="true" /><Input type="search" className="h-9 w-48 pl-8" aria-label={COPY.filterPeople} placeholder={COPY.filterPeople} value={filter} onChange={e => setFilter(e.target.value)} /></div>
            <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!data.users.length}><Download data-icon="inline-start" aria-hidden="true" />{COPY.exportPeople}</Button>
            <Button size="sm" variant="ghost" onClick={reload} disabled={loading}><RefreshCw data-icon="inline-start" aria-hidden="true" />{COPY.refresh}</Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2">
          {data.truncated && <Notice message={fill(COPY.truncated, { max: data.users.length })} />}
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

function GroupForm({ dives, group, mdAutomatic, notice = "", onSaved, onCancel }) {
  const [form, setForm] = React.useState(() => ({ name: group?.name || "", description: group?.description || "", access: group ? { dives: group.dives, chat: group.chat } : { dives: [], chat: true }, serviceAccount: group?.serviceAccount || "", resources: group?.resources || {}, createAccount: true, cap: group?.monthlyTokenCap ? String(group.monthlyTokenCap) : "" }));
  const [state, setState] = React.useState({ busy: false, message: notice, tone: "error" });
  const { reason, explain } = React.useContext(ReadOnly);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const granted = form.access.dives === "*" ? dives : dives.filter(dive => form.access.dives.includes(dive.key));
  const cap = form.cap.replace(/[\s,_.]/g, "");
  const body = () => JSON.stringify({ name: form.name, description: form.description, dives: form.access.dives, chat: form.access.chat, serviceAccount: form.serviceAccount.trim(), monthlyTokenCap: cap ? Number(cap) : null,
    resources: Object.fromEntries(Object.entries(form.resources).map(([key, list]) => [key, list.filter(item => item.alias.trim() && item.url.trim()).map(item => ({ alias: item.alias.trim(), url: item.url.trim() }))])) });
  const submit = async event => {
    event.preventDefault();
    if (reason) return explain();
    setState({ busy: true, message: "", tone: "error" });
    // A new service account name can be created in MotherDuck in the same step, so the first
    // sync does not fail with "does not exist".
    const creating = mdAutomatic && form.createAccount && form.serviceAccount.trim() && form.serviceAccount.trim() !== group?.serviceAccount;
    let id = group?.id;
    try {
      if (group) await api(`/api/admin/groups/${encodeURIComponent(group.id)}`, { method: "PATCH", body: body() });
      else ({ id } = await api("/api/admin/groups", { method: "POST", body: body() }));
    } catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: reasonFor(error) }), tone: "error" }); return; }
    if (creating) {
      try { await api(`/api/admin/groups/${encodeURIComponent(id)}/service-account`, { method: "POST" }); }
      catch (error) {
        const failure = fill(COPY.failed, { reason: error.data?.detail || reasonFor(error) });
        setState({ busy: false, message: failure, tone: "error" });
        // The group exists now, so the form reopens as that group's: saving again updates it
        // instead of creating a second one.
        onSaved({ keepOpen: true, id, failure });
        return;
      }
    }
    setState({ busy: false, message: "", tone: "error" });
    onSaved();
  };
  const createAccount = async () => {
    if (reason) return explain();
    setState({ busy: true, message: "", tone: "muted" });
    try { await api(`/api/admin/groups/${encodeURIComponent(group.id)}/service-account`, { method: "POST" }); setState({ busy: false, message: COPY.serviceAccountCreated, tone: "muted" }); onSaved({ keepOpen: true, id: group.id }); }
    catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: error.data?.detail || reasonFor(error) }), tone: "error" }); }
  };
  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
      <div className="grid gap-1.5"><Label htmlFor="group-name">{COPY.groupName}</Label><Input id="group-name" value={form.name} onChange={e => set("name", e.target.value)} required /></div>
      <div className="grid gap-1.5"><Label htmlFor="group-description">{COPY.description}</Label><Input id="group-description" value={form.description} onChange={e => set("description", e.target.value)} /></div>
      <AccessEditor dives={dives} value={form.access} onChange={access => set("access", access)} />
      <div className="grid content-start gap-1.5">
        <Label htmlFor="group-cap">{COPY.allowance}</Label>
        <Input id="group-cap" className="max-w-48 tabular-nums" inputMode="numeric" value={form.cap} onChange={e => set("cap", e.target.value)} placeholder="1000000" aria-describedby="group-cap-hint" aria-invalid={Boolean(cap) && (!/^\d+$/.test(cap) || Number(cap) < 1000) || undefined} />
        <span id="group-cap-hint" className="text-xs text-muted-foreground">{COPY.allowanceHint}</span>
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor="group-sa">{COPY.serviceAccount}</Label>
        <div className="flex flex-wrap gap-2">
          <Input id="group-sa" className="min-w-48 flex-1 font-mono text-xs" value={form.serviceAccount} onChange={e => set("serviceAccount", e.target.value.toLowerCase())} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          {group?.serviceAccount && mdAutomatic && <WriteButton type="button" size="sm" variant="outline" disabled={state.busy} onClick={createAccount}><Database data-icon="inline-start" aria-hidden="true" />{COPY.createServiceAccount}</WriteButton>}
        </div>
        <span className="text-xs text-muted-foreground">{COPY.serviceAccountHint}</span>
        {mdAutomatic && form.serviceAccount.trim() && form.serviceAccount.trim() !== group?.serviceAccount && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.createAccount} onChange={() => set("createAccount", !form.createAccount)} />{COPY.createServiceAccountNow}</label>}
      </div>
      {form.serviceAccount.trim() && granted.length > 0 && <ResourceEditor dives={granted} value={form.resources} onChange={resources => set("resources", resources)} />}
      <div className="flex items-center gap-2 md:col-span-2">
        <WriteButton type="submit" size="sm" disabled={state.busy || !form.name.trim() || (Boolean(cap) && (!/^\d+$/.test(cap) || Number(cap) < 1000))}>{state.busy ? <Spinner data-icon="inline-start" /> : null}{COPY.save}</WriteButton>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{COPY.cancel}</Button>
        <Notice message={state.message} tone={state.tone} />
      </div>
    </form>
  );
}

function GroupMembers({ group, users, onChanged }) {
  const [pick, setPick] = React.useState({ userId: "", manager: false });
  const [find, setFind] = React.useState("");
  const [state, setState] = React.useState({ busy: false, message: "" });
  const { reason, explain } = React.useContext(ReadOnly);
  const members = users.filter(user => (user.groups || []).some(item => item.id === group.id));
  const needle = find.trim().toLowerCase();
  const others = users.filter(user => !members.includes(user) && (!needle || [personName(user), user.name, user.email].some(value => String(value ?? "").toLowerCase().includes(needle))));
  const change = async (userId, manager, method = "PUT") => {
    if (reason) return explain();
    setState({ busy: true, message: "" });
    try {
      if (method === "PUT") await api(`/api/admin/groups/${encodeURIComponent(group.id)}/members`, { method, body: JSON.stringify({ userId, manager }) });
      else await api(`/api/admin/groups/${encodeURIComponent(group.id)}/members?user=${encodeURIComponent(userId)}`, { method });
      setPick({ userId: "", manager: false }); setFind("");
      setState({ busy: false, message: "" });
      onChanged();
    } catch (error) {
      const person = personName(users.find(user => user.id === userId));
      setState({ busy: false, message: error.message === "other_data_group" ? fill(COPY.otherDataGroup, { name: person, group: error.data?.group }) : fill(COPY.failed, { reason: reasonFor(error) }) });
    }
  };
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{COPY.members}</p>
      <ul className="grid gap-1">
        {members.map(user => {
          const manager = user.groups.find(item => item.id === group.id)?.manager;
          const name = personName(user);
          return (
            <li key={user.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-28 font-medium">{name}</span>
              <label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={Boolean(manager)} disabled={state.busy} aria-label={`${COPY.manager}: ${name}`} onChange={() => change(user.id, !manager)} />{COPY.manager}</label>
              <WriteButton size="sm" variant="ghost" disabled={state.busy} aria-label={`${fill(COPY.removeFromGroup, { group: group.name })}: ${name}`} onClick={() => change(user.id, false, "DELETE")}><UserMinus data-icon="inline-start" aria-hidden="true" />{fill(COPY.removeFromGroup, { group: group.name })}</WriteButton>
            </li>
          );
        })}
      </ul>
      <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); if (pick.userId) change(pick.userId, pick.manager); else if (reason) explain(); }}>
        {users.length > 20 && <Input type="search" className="h-9 w-44" aria-label={`${COPY.filterMembers}: ${group.name}`} placeholder={COPY.filterMembers} value={find} onChange={e => setFind(e.target.value)} />}
        <select aria-label={`${COPY.pickPerson}: ${group.name}`} className={select} value={pick.userId} onChange={e => setPick(current => ({ ...current, userId: e.target.value }))}>
          <option value="">{COPY.pickPerson}</option>
          {others.slice(0, 200).map(user => <option key={user.id} value={user.id}>{personName(user)}{user.name && user.name !== personName(user) ? ` (${user.name})` : ""}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={pick.manager} onChange={() => setPick(current => ({ ...current, manager: !current.manager }))} />{COPY.manager}</label>
        <WriteButton type="submit" size="sm" variant="outline" disabled={state.busy || (!pick.userId && !reason)}><UserPlus data-icon="inline-start" aria-hidden="true" />{COPY.addMember}</WriteButton>
      </form>
      <Notice message={state.message} tone="error" />
    </div>
  );
}

function GroupsTab({ data, mdAutomatic, reload }) {
  const [editing, setEditing] = React.useState(null);
  const [confirming, setConfirming] = React.useState(null);
  const [message, setMessage] = React.useState("");
  // A failure to show in the form that opens next: after a new group is created but its
  // service account is not, the form reopens as that group's.
  const [notice, setNotice] = React.useState("");
  const { reason, explain } = React.useContext(ReadOnly);
  const edit = id => { setNotice(""); setEditing(id); };
  const saved = ({ keepOpen = false, id = null, failure = "" } = {}) => { setNotice(failure); setEditing(keepOpen ? id : null); reload(); };
  const cancelDelete = id => { setConfirming(null); document.getElementById(`delete-group-${id}`)?.focus(); };
  const remove = async id => {
    if (reason) return explain();
    try { await api(`/api/admin/groups/${encodeURIComponent(id)}`, { method: "DELETE" }); setConfirming(null); setMessage(""); reload(); }
    catch (error) { setMessage(fill(COPY.failed, { reason: reasonFor(error) })); }
  };
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div className="grid max-w-3xl gap-1.5"><CardTitle role="heading" aria-level={2}>{COPY.groups}</CardTitle><CardDescription>{COPY.groupsBody}</CardDescription></div>
          {editing !== "new" && <Button size="sm" onClick={() => edit("new")}><Plus data-icon="inline-start" aria-hidden="true" />{COPY.newGroup}</Button>}
        </CardHeader>
        {editing === "new" && <CardContent><GroupForm dives={data.dives} mdAutomatic={mdAutomatic} onSaved={saved} onCancel={() => edit(null)} /></CardContent>}
      </Card>
      <Notice message={message} tone="error" />
      {!data.groups.length && <p className="text-sm text-muted-foreground">{COPY.noGroups}</p>}
      {data.groups.map(group => (
        <Card key={group.id}>
          <CardHeader className="flex flex-row flex-wrap items-start gap-2">
            <div className="mr-auto grid min-w-0 gap-1">
              <CardTitle role="heading" aria-level={2} className="flex flex-wrap items-center gap-2">{group.name}{group.serviceAccount && <Badge variant="outline"><Database aria-hidden="true" />{COPY.dataGroup}</Badge>}</CardTitle>
              <CardDescription>{[group.description, `${diveSummary(data.dives, group)} · ${COPY.chat} ${group.chatReady ? "✓" : "✗"}`, plural(COPY.memberCount, group.memberCount ?? 0), group.serviceAccount].filter(Boolean).join(" · ")}</CardDescription>
              {group.chat && !group.chatReady && <p className="text-xs text-muted-foreground">{COPY.chatNotReady}</p>}
              {group.monthlyTokenCap && (
                <div className="grid max-w-sm gap-1 text-xs text-muted-foreground">
                  <span className="flex flex-wrap items-center gap-2">{fill(COPY.allowanceUsed, { used: Number(group.tokensThisMonth ?? 0).toLocaleString(), cap: Number(group.monthlyTokenCap).toLocaleString() })}{(group.tokensThisMonth ?? 0) >= group.monthlyTokenCap && <Badge variant="destructive">{COPY.allowanceReached}</Badge>}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, ((group.tokensThisMonth ?? 0) / group.monthlyTokenCap) * 100)}%`, background: (group.tokensThisMonth ?? 0) >= group.monthlyTokenCap ? "var(--chart-attention)" : "var(--chart-answered)" }} /></span>
                </div>
              )}
            </div>
            <span className="flex shrink-0 flex-wrap gap-1">
              <Button size="sm" variant="ghost" aria-expanded={editing === group.id} aria-label={`${COPY.editGroup}: ${group.name}`} onClick={() => edit(editing === group.id ? null : group.id)}><Pencil data-icon="inline-start" aria-hidden="true" />{COPY.editGroup}</Button>
              {/* The same button asks once more, so keyboard focus stays on it. */}
              <WriteButton id={`delete-group-${group.id}`} size="sm" variant={confirming === group.id ? "destructive" : "ghost"} aria-label={`${confirming === group.id ? COPY.confirmDeleteGroup : COPY.deleteGroup}: ${group.name}`} aria-describedby={confirming === group.id ? `delete-group-warning-${group.id}` : undefined} onClick={() => (confirming === group.id ? remove(group.id) : setConfirming(group.id))}><Trash2 data-icon="inline-start" aria-hidden="true" />{confirming === group.id ? COPY.confirmDeleteGroup : COPY.deleteGroup}</WriteButton>
            </span>
            {confirming === group.id && (
              <div role="alert" className="flex w-full flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-2 text-sm">
                <span id={`delete-group-warning-${group.id}`} className="mr-auto">{fill(COPY.deleteGroupWarning, { name: group.name, members: plural(COPY.memberCount, group.memberCount ?? 0) })}</span>
                <Button size="sm" variant="ghost" onClick={() => cancelDelete(group.id)}>{COPY.cancel}</Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            {editing === group.id && <GroupForm dives={data.dives} group={group} mdAutomatic={mdAutomatic} notice={notice} onSaved={saved} onCancel={() => edit(null)} />}
            <GroupMembers group={group} users={data.users} onChanged={reload} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AccessSyncTab({ status, reload }) {
  const [state, setState] = React.useState({ busy: false, message: "", tone: "error" });
  const { reason, explain } = React.useContext(ReadOnly);
  const post = async body => {
    if (reason) return explain();
    setState({ busy: true, message: "", tone: "error" });
    try {
      const { result } = await api("/api/admin/access-sync", { method: "POST", body: JSON.stringify(body) });
      setState({ busy: false, message: result?.mode === "queued" ? COPY.queued : "", tone: "muted" });
      reload();
    } catch (error) { setState({ busy: false, message: fill(COPY.failed, { reason: reasonFor(error) }), tone: "error" }); }
  };
  if (!status) return <Spinner />;
  if (status.error) return <Notice message={fill(COPY.failed, { reason: status.error })} tone="error" />;
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div className="grid max-w-3xl gap-1.5"><CardTitle role="heading" aria-level={2}>{COPY.mdTitle}</CardTitle><CardDescription>{status.mode === "automatic" ? COPY.mdAutomatic : COPY.mdManual}</CardDescription></div>
          <span className="flex gap-1">
            <WriteButton size="sm" disabled={state.busy} onClick={() => post({})}>{state.busy ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" aria-hidden="true" />}{state.busy ? COPY.syncing : COPY.syncNow}</WriteButton>
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
                      <td className="py-2"><Badge variant={row.state === "failed" ? "destructive" : "outline"}>{COPY.states[row.state] || row.state}</Badge>{row.detail && !["pending", "removing"].includes(row.state) && <p className="mt-1 max-w-md text-xs text-muted-foreground">{row.detail}</p>}</td>
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
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle role="heading" aria-level={2}>{COPY.sqlTitle}</CardTitle><span className="flex gap-1"><CopyButton text={status.sql} />{status.mode === "manual" && <WriteButton size="sm" variant="outline" disabled={state.busy} onClick={() => post({ confirm: status.planned || [] })}><CheckCheck data-icon="inline-start" aria-hidden="true" />{COPY.markDone}</WriteButton>}</span></CardHeader>
          <CardContent className="grid gap-2">{status.mode === "manual" && <p className="text-xs text-muted-foreground">{COPY.markDoneHint}</p>}<pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{status.sql}</pre></CardContent>
        </Card>
      )}
    </div>
  );
}

const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const seconds = ms => (ms == null ? "—" : fill(COPY.seconds, { s: (Number(ms) / 1000).toFixed(1) }));
const shortDay = day => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const feedbackWord = value => (value === 1 ? "helpful" : value === -1 ? "not helpful" : "");

function StatTile({ label, value, detail }) {
  return (
    <div className="grid content-start gap-0.5 rounded-lg border border-border px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </div>
  );
}

const Swatch = ({ color }) => <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: `var(${color})` }} aria-hidden="true" />;

// Questions per day, the part that needs attention stacked on top. Hovering a day shows its
// numbers in the line above the bars; screen readers get the same numbers as a table.
function DailyChart({ daily }) {
  const [hover, setHover] = React.useState(null);
  const max = Math.max(1, ...daily.map(day => day.questions));
  const total = daily.reduce((sum, day) => ({ questions: sum.questions + day.questions, attention: sum.attention + day.unsuccessful + day.negative }), { questions: 0, attention: 0 });
  const day = hover == null ? null : daily[hover];
  return (
    <figure className="grid gap-2">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{COPY.perDay}</span>
        <span className="flex items-center gap-1.5"><Swatch color="--chart-answered" />{COPY.statuses.answered}</span>
        <span className="flex items-center gap-1.5"><Swatch color="--chart-attention" />{COPY.needsAttention}</span>
      </figcaption>
      <p className="min-h-4 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
        {day
          ? fill(COPY.dayReadout, { day: shortDay(day.day), questions: plural(COPY.questionCount, day.questions), attention: day.unsuccessful + day.negative })
          : fill(COPY.periodReadout, { questions: plural(COPY.questionCount, total.questions), attention: total.attention })}
      </p>
      <div className="relative flex h-32 items-end gap-px border-b border-border" aria-hidden="true" onMouseLeave={() => setHover(null)}>
        <span className="pointer-events-none absolute left-0 top-0 text-[11px] tabular-nums text-muted-foreground">{max}</span>
        {daily.map((entry, index) => {
          // A thumbs down on an answered question also counts as needing attention.
          const attention = Math.min(entry.questions, entry.unsuccessful + entry.negative);
          return (
            <div key={entry.day} className={`flex h-full min-w-0 flex-1 flex-col justify-end gap-[2px] ${hover === index ? "bg-muted" : ""}`} onMouseEnter={() => setHover(index)}>
              {attention > 0 && <div className="rounded-t-sm" style={{ height: `${(attention / max) * 100}%`, background: "var(--chart-attention)" }} />}
              {entry.questions - attention > 0 && <div className={attention ? "" : "rounded-t-sm"} style={{ height: `${((entry.questions - attention) / max) * 100}%`, background: "var(--chart-answered)" }} />}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden="true"><span>{shortDay(daily[0].day)}</span><span>{shortDay(daily.at(-1).day)}</span></div>
      <table className="sr-only">
        <caption>{COPY.perDay}</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">{COPY.colQuestions}</th><th scope="col">{COPY.colAttention}</th></tr></thead>
        <tbody>{daily.filter(entry => entry.questions).map(entry => <tr key={entry.day}><th scope="row">{entry.day}</th><td>{entry.questions}</td><td>{entry.unsuccessful + entry.negative}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

// One split (Dive, group or model): a row per value with a bar for its share of the questions.
function SplitTable({ title, rows, name }) {
  const max = Math.max(1, ...rows.map(row => row.questions));
  return (
    <div className="grid content-start gap-2">
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground"><tr><th scope="col" className="pb-1 text-left font-normal">{COPY.colName}</th><th scope="col" className="pb-1 text-right font-normal">{COPY.colQuestions}</th><th scope="col" className="pb-1 text-right font-normal">{COPY.colAttention}</th><th scope="col" className="pb-1 text-right font-normal"><ThumbsUp className="ml-auto size-3.5" aria-label={COPY.helpful} /></th><th scope="col" className="pb-1 text-right font-normal"><ThumbsDown className="ml-auto size-3.5" aria-label={COPY.notHelpful} /></th></tr></thead>
        <tbody>
          {rows.map(row => (
            <tr key={name(row)} className="border-t border-border">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                <span className="block truncate">{name(row)}</span>
                <span className="mt-1 block h-1.5 rounded-full" style={{ width: `${Math.max(2, (row.questions / max) * 100)}%`, background: "var(--chart-answered)" }} aria-hidden="true" />
              </th>
              <td className="py-1.5 text-right tabular-nums">{row.questions}</td>
              <td className="py-1.5 text-right tabular-nums">{row.unsuccessful + row.negative || "—"}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{row.positive || "—"}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{row.negative || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// An entry in a question list. Administrators open the conversation; group managers only read.
function QuestionItem({ onOpen, conversationId, children }) {
  const className = "grid w-full gap-1 border-b border-border px-1 py-2 text-left last:border-b-0";
  return onOpen
    ? <button type="button" onClick={() => onOpen(conversationId)} title={COPY.openConversation} className={`${className} hover:bg-muted`}>{children}</button>
    : <div className={className}>{children}</div>;
}

const money = (amount, currency) => { try { return amount.toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: amount < 0.1 ? 4 : amount < 10 ? 2 : 0 }); } catch { return `${amount.toFixed(2)} ${currency}`; } };

function QuestionsTab({ dives, onOpen }) {
  const [filters, setFilters] = React.useState({ days: "30", dive: "", group: "" });
  const [data, setData] = React.useState(null);
  const [state, setState] = React.useState({ loading: true, error: "", exporting: false });
  const [action, setAction] = React.useState({ busy: "", message: "", tone: "muted" });
  const { reason, explain } = React.useContext(ReadOnly);
  const diveTitle = key => dives.find(dive => dive.key === key)?.title || key;
  const params = React.useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, value]) => value)), [filters]);
  // Changing a filter while a slower answer is on its way drops that answer.
  const request = useLatestRequest();
  const load = React.useCallback(async () => {
    const signal = request.start();
    setState(current => ({ ...current, loading: true, error: "" }));
    try {
      const next = await api(`/api/admin/insights?${params}`, { signal });
      if (signal.aborted) return;
      setData(next); setState(current => ({ ...current, loading: false }));
    } catch (error) { if (!signal.aborted) setState(current => ({ ...current, loading: false, error: reasonFor(error) })); }
  }, [params, request]);
  React.useEffect(() => { load(); return request.abort; }, [load, request]);
  const exportCsv = async () => {
    setState(current => ({ ...current, exporting: true, error: "" }));
    try {
      const { rows } = await api(`/api/admin/insights?${params}&format=rows`);
      downloadText([
        "asked_at,person,dive,groups,question,status,feedback,feedback_reason,feedback_note,topic,data_missing,model,model_id,seconds,input_tokens,output_tokens,tool_calls,dive_state,conversation_id",
        ...rows.map(row => [row.asked_at, row.user_label, row.dive_key, row.group_names.join("; "), row.question, row.status, feedbackWord(row.feedback), row.feedback_reason, row.feedback_note, row.topic, row.data_gap ? "yes" : "", row.model_tier, row.model_id, row.worked_ms == null ? "" : (row.worked_ms / 1000).toFixed(1), row.input_tokens, row.output_tokens, row.tool_calls, row.dive_state ? JSON.stringify(row.dive_state) : "", row.conversation_id].map(csvCell).join(",")),
      ].join("\n"), `questions-${filters.days}d.csv`, "text/csv");
      setState(current => ({ ...current, exporting: false }));
    } catch (error) { setState(current => ({ ...current, exporting: false, error: reasonFor(error) })); }
  };
  // Administrator actions: group questions into topics, post the digest now.
  const runAction = async (key, request, done) => {
    if (reason) return explain();
    setAction({ busy: key, message: "", tone: "muted" });
    try { const result = await request(); setAction({ busy: "", message: done(result), tone: "muted" }); load(); }
    catch (error) { setAction({ busy: "", message: fill(COPY.failed, { reason: reasonFor(error) }), tone: "error" }); }
  };
  const groupTopics = () => runAction("topics", () => api(`/api/admin/insights/topics?${params}`, { method: "POST" }), result => fill(COPY.topicsDone, { n: result.classified }));
  const sendDigest = () => runAction("digest", () => api("/api/admin/digest", { method: "POST" }), () => COPY.digestSent);
  const admin = data?.scope !== "manager";
  const totals = data?.totals;
  const diveKeys = [...new Set([...dives.map(dive => dive.key), ...(data?.facets?.dives || [])])];
  const rated = totals ? totals.positive + totals.negative : 0;
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="grid gap-3">
          <div className="grid max-w-3xl gap-1.5"><CardTitle role="heading" aria-level={2}>{COPY.questionsTitle}</CardTitle><CardDescription>{admin ? COPY.questionsBody : fill(COPY.managerQuestions, { groups: (data?.facets?.groups || []).join(", ") })}</CardDescription></div>
          <div className="flex flex-wrap gap-2">
            <select aria-label={COPY.period} className={select} value={filters.days} onChange={e => setFilters(f => ({ ...f, days: e.target.value }))}>
              {COPY.periods.map(([days, label]) => <option key={days} value={days}>{label}</option>)}
            </select>
            <select aria-label={COPY.allDivesFilter} className={select} value={filters.dive} onChange={e => setFilters(f => ({ ...f, dive: e.target.value }))}>
              <option value="">{COPY.allDivesFilter}</option>
              {diveKeys.map(key => <option key={key} value={key}>{diveTitle(key)}</option>)}
            </select>
            <select aria-label={COPY.allGroups} className={select} value={filters.group} onChange={e => setFilters(f => ({ ...f, group: e.target.value }))}>
              <option value="">{COPY.allGroups}</option>
              {(data?.facets?.groups || []).map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <span className="flex gap-2 sm:ml-auto">
              <Button size="sm" variant="ghost" onClick={load} disabled={state.loading}><RefreshCw data-icon="inline-start" aria-hidden="true" />{COPY.refresh}</Button>
              {admin && data?.digest && <WriteButton size="sm" variant="ghost" onClick={sendDigest} disabled={Boolean(action.busy)}>{COPY.sendDigest}</WriteButton>}
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={state.exporting || !totals?.questions}><Download data-icon="inline-start" aria-hidden="true" />{COPY.exportQuestions}</Button>
            </span>
          </div>
          <Notice message={action.message} tone={action.tone} />
        </CardHeader>
        <CardContent className="grid gap-5">
          <Notice message={state.error && fill(COPY.failed, { reason: state.error })} tone="error" />
          {state.loading && !data && <Spinner />}
          {totals && !totals.questions && <p className="text-sm text-muted-foreground">{COPY.noQuestions}</p>}
          {totals?.questions > 0 && (
            <>
              <div className={`grid grid-cols-2 gap-2 ${data.cost ? "lg:grid-cols-5" : "lg:grid-cols-4"}`} aria-busy={state.loading}>
                <StatTile label={COPY.tileQuestions} value={totals.questions} detail={fill(COPY.tileQuestionsDetail, { people: plural(COPY.people, totals.askers), conversations: plural(COPY.conversationCount, totals.conversations) })} />
                <StatTile label={COPY.tileAnswered} value={`${percent(totals.answered, totals.questions)}%`} detail={fill(COPY.tileAnsweredDetail, totals)} />
                <StatTile label={COPY.tileFeedback} value={<span className="flex items-center gap-3"><span className="flex items-center gap-1"><ThumbsUp className="size-4" aria-label={COPY.helpful} />{totals.positive}</span><span className="flex items-center gap-1"><ThumbsDown className="size-4" aria-label={COPY.notHelpful} />{totals.negative}</span></span>} detail={fill(COPY.tileFeedbackDetail, { rated: percent(rated, totals.answered) })} />
                <StatTile label={COPY.tileSpeed} value={seconds(totals.median_ms)} detail={fill(COPY.tileSpeedDetail, { tokens: Number(totals.input_tokens + totals.output_tokens).toLocaleString() })} />
                {data.cost && <StatTile label={COPY.tileCost} value={money(data.cost.total, data.cost.currency)} detail={[Object.entries(data.cost.byTier).map(([tier, amount]) => `${tier} ${money(amount, data.cost.currency)}`).join(" · "), data.cost.unpriced.length ? fill(COPY.unpriced, { tiers: data.cost.unpriced.join(", ") }) : ""].filter(Boolean).join(" · ") || COPY.tileCostDetail} />}
              </div>
              <DailyChart daily={data.daily} />
            </>
          )}
        </CardContent>
      </Card>
      {totals?.questions > 0 && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader><CardTitle role="heading" aria-level={2}>{COPY.attention}</CardTitle><CardDescription>{COPY.attentionHint}</CardDescription></CardHeader>
              <CardContent>
                {!data.attention.length && <p className="text-sm text-muted-foreground">{COPY.noAttention}</p>}
                <ul className="grid">
                  {data.attention.map(item => (
                    <li key={item.question_id}>
                      <QuestionItem onOpen={onOpen} conversationId={item.conversation_id}>
                        <span className="line-clamp-2 text-sm">{item.question}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {item.status !== "answered" && <Badge variant="destructive">{COPY.statuses[item.status] || item.status}</Badge>}
                          {item.feedback === -1 && <Badge variant="outline"><ThumbsDown aria-hidden="true" />{item.feedback_reason ? FEEDBACK_REASONS[item.feedback_reason] || item.feedback_reason : COPY.notHelpful}</Badge>}
                          {item.user_label} · {diveTitle(item.dive_key)} · {dateTime(item.asked_at)}
                        </span>
                        {item.feedback_note && <span className="text-xs text-muted-foreground">“{item.feedback_note}”</span>}
                      </QuestionItem>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader><CardTitle role="heading" aria-level={2}>{COPY.frequent}</CardTitle><CardDescription>{COPY.frequentHint}</CardDescription></CardHeader>
              <CardContent>
                <ol className="grid">
                  {data.frequent.map(item => (
                    <li key={item.question + item.last_asked_at}>
                      <QuestionItem onOpen={onOpen} conversationId={item.conversation_id}>
                        <span className="line-clamp-2 text-sm">{item.question}</span>
                        <span className="text-xs text-muted-foreground">{fill(COPY.askedBy, { questions: plural(COPY.questionCount, item.questions), people: plural(COPY.people, item.askers), when: dateTime(item.last_asked_at) })}{item.unsuccessful + item.negative ? ` · ${item.unsuccessful + item.negative} ${COPY.needsAttention.toLowerCase()}` : ""}</span>
                      </QuestionItem>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader className="grid gap-2">
                <CardTitle role="heading" aria-level={2}>{COPY.topics}</CardTitle>
                <CardDescription>{COPY.topicsHint}</CardDescription>
                {admin && (
                  <div className="flex flex-wrap items-center gap-2">
                    <WriteButton size="sm" variant="outline" onClick={groupTopics} disabled={Boolean(action.busy) || !totals.unclassified || !data.topicsAvailable}>{action.busy === "topics" ? <><Spinner data-icon="inline-start" />{COPY.groupingTopics}</> : COPY.groupTopics}</WriteButton>
                    <span className="text-xs text-muted-foreground">{!data.topicsAvailable ? COPY.topicsNeedModel : totals.unclassified ? plural(COPY.unclassified, totals.unclassified) : ""}</span>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {data.topics.length ? <SplitTable title="" rows={data.topics} name={row => row.topic} /> : <p className="text-sm text-muted-foreground">{COPY.noTopics}</p>}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader><CardTitle role="heading" aria-level={2}>{COPY.gaps}</CardTitle><CardDescription>{COPY.gapsHint}</CardDescription></CardHeader>
              <CardContent>
                {!data.gaps.length && <p className="text-sm text-muted-foreground">{COPY.noGaps}</p>}
                <ul className="grid">
                  {data.gaps.map(item => (
                    <li key={item.question_id}>
                      <QuestionItem onOpen={onOpen} conversationId={item.conversation_id}>
                        <span className="line-clamp-2 text-sm">{item.question}</span>
                        <span className="text-xs text-muted-foreground">{[item.topic, item.user_label, diveTitle(item.dive_key), dateTime(item.asked_at)].filter(Boolean).join(" · ")}</span>
                      </QuestionItem>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="grid gap-6 pt-6 lg:grid-cols-3">
              <SplitTable title={COPY.byDive} rows={data.dives} name={row => diveTitle(row.dive_key)} />
              <SplitTable title={COPY.byGroup} rows={data.groups} name={row => row.group_name || COPY.noGroup} />
              <SplitTable title={COPY.byModel} rows={data.models} name={row => row.model_tier || COPY.noModel} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ActivityTab() {
  const [filters, setFilters] = React.useState({ q: "", action: "" });
  const [events, setEvents] = React.useState([]);
  const [state, setState] = React.useState({ loading: true, error: "", more: false });
  // Only the newest request counts, so "Load more" for the old filters never appends to new results.
  const request = useLatestRequest();
  const load = React.useCallback(async (offset = 0) => {
    const signal = request.start();
    setState(current => ({ ...current, loading: true, error: "" }));
    const params = new URLSearchParams({ offset: String(offset), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) });
    try {
      const data = await api(`/api/admin/audit?${params}`, { signal });
      if (signal.aborted) return;
      setEvents(current => (offset ? [...current, ...data.events] : data.events));
      setState({ loading: false, error: "", more: data.events.length === 100 });
    } catch (error) { if (!signal.aborted) setState({ loading: false, error: reasonFor(error), more: false }); }
  }, [filters, request]);
  React.useEffect(() => { const timer = setTimeout(() => load(0), 250); return () => { clearTimeout(timer); request.abort(); }; }, [load, request]);
  const describe = detail => (detail && typeof detail === "object" ? Object.entries(detail).filter(([, value]) => value !== null && value !== undefined && value !== "").map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") || "—" : String(value)}`).join(" · ") : "");
  return (
    <Card>
      <CardHeader className="grid gap-3">
        <div className="grid max-w-3xl gap-1.5"><CardTitle role="heading" aria-level={2}>{COPY.activityTitle}</CardTitle><CardDescription>{COPY.activityBody}</CardDescription></div>
        <div className="flex flex-wrap gap-2">
          <div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" aria-hidden="true" /><Input type="search" className="h-9 w-56 pl-8" aria-label={COPY.filterActivity} placeholder={COPY.filterActivity} value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} /></div>
          <select aria-label={COPY.allActions} className={select} value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}>
            <option value="">{COPY.allActions}</option>
            {Object.entries(COPY.actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        <Notice message={state.error && fill(COPY.failed, { reason: state.error })} tone="error" />
        {!state.loading && !events.length && !state.error && <p className="text-sm text-muted-foreground">{COPY.noActivity}</p>}
        <ol className="grid">
          {events.map(event => (
            <li key={event.id} className="grid gap-0.5 border-b border-border py-2 text-sm last:border-b-0">
              <span><span className="font-medium">{event.actor_label || "—"}</span>: {COPY.actions[event.action] || event.action}{event.target_label && <> <span className="font-medium">{event.target_label}</span></>}</span>
              <span className="text-xs text-muted-foreground">{[dateTime(event.created_at), describe(event.detail)].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ol>
        {state.loading && <Spinner />}
        {state.more && !state.loading && <Button size="sm" variant="ghost" onClick={() => load(events.length)}>{COPY.loadMore}</Button>}
      </CardContent>
    </Card>
  );
}

function ConversationDetail({ id, diveTitle, onDeleted }) {
  const [conversation, setConversation] = React.useState(null);
  const [error, setError] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    setConversation(null); setError(""); setConfirming(false);
    api(`/api/admin/conversations/${encodeURIComponent(id)}`).then(data => active && setConversation(data.conversation)).catch(err => active && setError(reasonFor(err)));
    return () => { active = false; };
  }, [id]);
  if (error) return <Notice message={fill(COPY.failed, { reason: error })} tone="error" />;
  if (!conversation) return <Spinner />;
  const exportJson = () => downloadText(JSON.stringify(conversation, null, 2), `conversation-${conversation.id}.json`, "application/json");
  const remove = async () => {
    try { await api(`/api/admin/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }); onDeleted(); }
    catch (err) { setError(reasonFor(err)); }
  };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto min-w-0"><h3 className="font-medium">{conversation.title}</h3><p className="text-xs text-muted-foreground">{conversation.user_label} · {diveTitle(conversation.dive_key)} · {dateTime(conversation.created_at)}</p></div>
        <span className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={exportJson}><Download data-icon="inline-start" aria-hidden="true" />{COPY.exportJson}</Button>
          {/* The same button asks once more, so keyboard focus stays on it. */}
          <WriteButton size="sm" variant={confirming ? "destructive" : "ghost"} onClick={confirming ? remove : () => setConfirming(true)}><Trash2 data-icon="inline-start" aria-hidden="true" />{confirming ? COPY.confirmRemove : COPY.remove}</WriteButton>
        </span>
      </div>
      <ol className="grid gap-3">
        {conversation.messages.map(message => (
          <li key={message.id} className={message.role === "user" ? "rounded-md bg-muted px-3 py-2" : "rounded-md border border-border px-3 py-2"}>
            <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {message.role === "user" ? COPY.question : COPY.answer} · {dateTime(message.created_at)}
              {message.status && message.status !== "answered" && <Badge variant="destructive">{COPY.statuses[message.status] || message.status}</Badge>}
              {message.feedback === 1 && <Badge variant="outline"><ThumbsUp aria-hidden="true" />{COPY.helpful}</Badge>}
              {message.feedback === -1 && <Badge variant="outline"><ThumbsDown aria-hidden="true" />{COPY.notHelpful}{message.feedback_reason ? `: ${FEEDBACK_REASONS[message.feedback_reason] || message.feedback_reason}` : ""}</Badge>}
            </p>
            {/* Answers render as the person saw them in the chat; questions stay plain text. */}
            {message.role === "assistant" ? <MessageResponse className="h-auto text-sm">{message.content}</MessageResponse> : <p className="whitespace-pre-wrap text-sm">{message.content}</p>}
            {message.role === "assistant" && message.feedback_note && <p className="mt-1 text-xs text-muted-foreground">“{message.feedback_note}”</p>}
            {message.role === "user" && message.topic && <p className="mt-1 text-xs text-muted-foreground">{fill(COPY.topicLabel, { topic: message.topic })}{message.data_gap ? ` · ${FEEDBACK_REASONS.missing_data}` : ""}</p>}
            {message.role === "user" && message.group_names?.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{fill(COPY.askedFrom, { groups: message.group_names.join(", ") })}</p>}
            {message.role === "user" && message.dive_state && Object.keys(message.dive_state).length > 0 && <p className="mt-1 break-words text-xs text-muted-foreground">{fill(COPY.askedWith, { state: Object.entries(message.dive_state).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ") })}</p>}
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

function ConversationsTab({ users, dives, initial }) {
  const [filters, setFilters] = React.useState({ user: "", dive: "", q: "", attention: "" });
  const [items, setItems] = React.useState([]);
  const [state, setState] = React.useState({ loading: true, error: "", more: false });
  // Opened from the Questions tab with a conversation already picked.
  const [selected, setSelected] = React.useState(initial ?? null);
  const detailRef = React.useRef(null);
  const diveTitle = key => dives.find(dive => dive.key === key)?.title || key;
  const open = id => {
    setSelected(id);
    // On narrow screens the detail sits below the list, so bring it into view.
    if (window.matchMedia("(max-width: 1023px)").matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  // Only the newest request counts, so "Load more" for the old filters never appends to new results.
  const request = useLatestRequest();
  const load = React.useCallback(async (offset = 0) => {
    const signal = request.start();
    setState(current => ({ ...current, loading: true, error: "" }));
    const params = new URLSearchParams({ limit: "50", offset: String(offset), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) });
    try {
      const { conversations } = await api(`/api/admin/conversations?${params}`, { signal });
      if (signal.aborted) return;
      setItems(current => (offset ? [...current, ...conversations] : conversations));
      setState({ loading: false, error: "", more: conversations.length === 50 });
    } catch (error) { if (!signal.aborted) setState({ loading: false, error: reasonFor(error), more: false }); }
  }, [filters, request]);
  React.useEffect(() => { const timer = setTimeout(() => load(0), 250); return () => { clearTimeout(timer); request.abort(); }; }, [load, request]);
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
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={filters.attention === "1"} onChange={e => setFilters(f => ({ ...f, attention: e.target.checked ? "1" : "" }))} />{COPY.needsAttentionFilter}</label>
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
                  {(item.unsuccessful_count > 0 || item.negative_count > 0 || item.positive_count > 0) && (
                    <span className="flex flex-wrap gap-1.5">
                      {item.unsuccessful_count > 0 && <Badge variant="destructive">{COPY.needsAttention} · {item.unsuccessful_count}</Badge>}
                      {item.negative_count > 0 && <Badge variant="outline"><ThumbsDown aria-label={COPY.notHelpful} />{item.negative_count}</Badge>}
                      {item.positive_count > 0 && <Badge variant="outline"><ThumbsUp aria-label={COPY.helpful} />{item.positive_count}</Badge>}
                    </span>
                  )}
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

const tabFromHash = () => (typeof window !== "undefined" && /^#(users|groups|motherduck|activity|questions|conversations|models)$/.test(window.location.hash) ? window.location.hash.slice(1) : "users");

export default function AdminApp() {
  const [status, setStatus] = React.useState({ state: "loading" });
  // The open tab lives in the URL (#groups), so reloading or sharing the address keeps it.
  const [tab, setTabState] = React.useState(tabFromHash);
  // A link or an edited address bar that changes only the #tab switches tabs too.
  React.useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const setTab = React.useCallback(key => { setTabState(key); try { window.history.replaceState(null, "", key === "users" ? window.location.pathname : `#${key}`); } catch { /* the tab still changes */ } }, []);
  const [data, setData] = React.useState({ users: [], groups: [], dives: [], scope: "admin", me: null });
  const [sync, setSync] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [toast, setToast] = React.useState("");
  const [openConversation, setOpenConversation] = React.useState(null);
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
    try { document.documentElement.classList.toggle("dark", window.localStorage.getItem("dive_app_theme") === "dark"); } catch { /* theme is optional */ }
    document.title = COPY.title;
  }, []);

  // A failed sync status shows as an error on its tab instead of a spinner that never ends.
  const loadSync = React.useCallback(async () => {
    try { setSync(await api("/api/admin/access-sync")); } catch (error) { setSync({ error: reasonFor(error), grants: [] }); }
  }, []);
  const fetchPeople = React.useCallback(async () => {
    const people = await api("/api/admin/people");
    setData(people);
    if (people.scope === "admin") await loadSync();
  }, [loadSync]);
  // Reloads after a change. The previous list stays on screen, with the failure above it.
  const load = React.useCallback(async () => {
    setLoading(true);
    try { await fetchPeople(); setLoadError(""); }
    catch (error) { setLoadError(fill(COPY.failed, { reason: reasonFor(error) })); }
    finally { setLoading(false); }
  }, [fetchPeople]);

  React.useEffect(() => {
    (async () => {
      try {
        const auth = await api("/api/auth");
        if (auth.mode !== "accounts") return setStatus({ state: "off" });
        if (!auth.authenticated) return setStatus({ state: "signin" });
        if (!auth.user?.canManage) return setStatus({ state: "forbidden" });
        await fetchPeople();
        setStatus({ state: "ready", demo: Boolean(auth.publicDemo) });
      } catch (error) { setStatus({ state: "error", message: reasonFor(error) }); }
    })();
  }, [fetchPeople]);

  const admin = data.scope === "admin";
  const tabs = [["users", COPY.users, Users], ...(admin ? [["groups", COPY.groups, UsersRound], ["motherduck", COPY.motherduck, Database], ["activity", COPY.activity, History], ["questions", COPY.questions, ChartColumn], ["conversations", COPY.conversations, MessageSquare], ["models", COPY.models, Bot]] : [["questions", COPY.questions, ChartColumn]])];
  const shown = tabs.some(([key]) => key === tab) ? tab : "users";
  React.useEffect(() => { if (status.state === "ready" && shown === "motherduck") loadSync(); }, [status.state, shown, loadSync]);
  // Arrow keys move between tabs, as in any tab list.
  // A conversation opened from Questions is shown once; choosing a tab by hand starts from the list.
  const chooseTab = key => { setOpenConversation(null); setTab(key); };
  const onTabKey = event => {
    const index = tabs.findIndex(([key]) => key === shown);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const key = tabs[(next + tabs.length) % tabs.length][0];
    chooseTab(key);
    document.getElementById(`tab-${key}`)?.focus();
  };
  const message = { off: [COPY.accountsOff, COPY.accountsOffBody], signin: [COPY.title, COPY.signIn], forbidden: [COPY.title, COPY.notAdmin], error: [COPY.title, fill(COPY.failed, { reason: status.message })] }[status.state];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <Button size="sm" variant="ghost" nativeButton={false} render={<a href="/" />}><ArrowLeft data-icon="inline-start" aria-hidden="true" />{COPY.back}</Button>
        <h1 className="text-base font-semibold">{COPY.title}</h1>
        {status.state === "ready" && (
          <div role="tablist" aria-label={COPY.title} className="flex w-full flex-wrap gap-1 sm:ml-auto sm:w-auto" onKeyDown={onTabKey}>
            {tabs.map(([key, label, Icon]) => <Button key={key} id={`tab-${key}`} role="tab" aria-selected={shown === key} aria-controls="admin-panel" tabIndex={shown === key ? 0 : -1} size="sm" variant={shown === key ? "secondary" : "ghost"} onClick={() => chooseTab(key)}><Icon data-icon="inline-start" aria-hidden="true" />{label}</Button>)}
          </div>
        )}
      </header>
      <ReadOnly.Provider value={readOnly}>
      <main id="admin-panel" role={status.state === "ready" ? "tabpanel" : undefined} aria-labelledby={status.state === "ready" ? `tab-${shown}` : undefined} className="mx-auto grid max-w-6xl gap-6 px-4 py-6">
        {status.state === "loading" && <Spinner />}
        {status.demo && (
          <Card>
            <CardHeader><CardTitle role="heading" aria-level={2}>{COPY.demoTitle}</CardTitle><CardDescription>{COPY.demoBody}</CardDescription></CardHeader>
            <CardContent><ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">{COPY.demoTry.map(item => <li key={item}>{item}</li>)}</ul></CardContent>
          </Card>
        )}
        {status.state === "ready" && <Notice message={loadError} tone="error" />}
        {message && <Card><CardHeader><CardTitle role="heading" aria-level={2}>{message[0]}</CardTitle><CardDescription>{message[1]}</CardDescription></CardHeader>{status.state === "signin" && <CardContent><Button nativeButton={false} render={<a href="/" />}>{COPY.back}</Button></CardContent>}</Card>}
        {status.state === "ready" && shown === "users" && <UsersTab data={data} grants={sync?.grants || []} reload={load} loading={loading} />}
        {status.state === "ready" && admin && shown === "groups" && <GroupsTab data={data} mdAutomatic={data.mdAutomatic ?? sync?.mode === "automatic"} reload={load} />}
        {status.state === "ready" && admin && shown === "motherduck" && <AccessSyncTab status={sync} reload={loadSync} />}
        {status.state === "ready" && admin && shown === "activity" && <ActivityTab />}
        {status.state === "ready" && shown === "questions" && <QuestionsTab dives={data.dives} onOpen={admin ? id => { setOpenConversation(id); setTab("conversations"); window.scrollTo({ top: 0 }); } : undefined} />}
        {status.state === "ready" && admin && shown === "conversations" && <ConversationsTab key={openConversation ?? "all"} users={data.users} dives={data.dives} initial={openConversation} />}
        {status.state === "ready" && admin && shown === "models" && <ModelsTab demo={Boolean(status.demo)} />}
      </main>
      <DemoToast message={toast} />
      </ReadOnly.Provider>
    </div>
  );
}
