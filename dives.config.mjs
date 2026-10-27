// The Dives listed in the sidebar. To add one, copy an entry and set its env vars.
// Ids, versions and share URLs come from env names so no account details live in git.
//
// key          url-safe id, also the chat history key
// title        sidebar label            description  one line under the title
// icon         one of: layout-dashboard, table, chart-column, chart-line, map, file-text, users, database
// diveIdEnv    env var holding the Dive UUID (or diveId: '<uuid>' to hard-code it)
// versionEnv   optional env var pinning a saved Dive version (or version: 3)
// usernameEnv  env var with the read-only service account the Dive runs as
//              (default MOTHERDUCK_EMBED_USERNAME)
// resources    databases/shares the Dive declares in REQUIRED_DATABASES, as
//              { urlEnv | url: 'md:_share/...', alias } with the same alias the Dive's SQL uses
// chat         optional { tokenEnv, databaseEnv }: a read-only token and the database the
//              assistant may query for this Dive. Omit to show the Dive without chat.
// starters     optional starter questions for the chat panel
// linkHosts    optional hostnames the Dive may open in a new tab
export default [
  {
    key: 'overview',
    title: 'Overview',
    description: 'Headline numbers for the demo dataset.',
    icon: 'layout-dashboard',
    diveIdEnv: 'DIVE_OVERVIEW_ID',
    versionEnv: 'DIVE_OVERVIEW_VERSION',
    // The included starter Dive reads no database, so it needs no resource/share.
    resources: [],
    chat: { tokenEnv: 'MOTHERDUCK_CHAT_TOKEN', databaseEnv: 'DIVE_OVERVIEW_CHAT_DATABASE' },
    starters: ['What does this Dive show?', 'Which tables can you query?', 'Summarise the key numbers.'],
  },
  {
    key: 'explorer',
    title: 'Explorer',
    description: 'Drill into individual records.',
    icon: 'table',
    diveIdEnv: 'DIVE_EXPLORER_ID',
    versionEnv: 'DIVE_EXPLORER_VERSION',
    resources: [{ urlEnv: 'DIVE_EXPLORER_SHARE_URL', alias: 'demo' }],
    chat: { tokenEnv: 'MOTHERDUCK_CHAT_TOKEN', databaseEnv: 'DIVE_EXPLORER_CHAT_DATABASE' },
  },
];
