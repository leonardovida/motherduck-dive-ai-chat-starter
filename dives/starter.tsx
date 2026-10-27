import { useDiveState, useSQLQuery } from '@motherduck/react-sql-query';

// Placeholder Dive for the starter app. Replace it with your own Dive and list the
// databases it reads here, using the same aliases as `resources` in dives.config.mjs:
// export const REQUIRED_DATABASES = [{ type: 'share', path: 'md:_share/...', alias: 'demo' }];
export const REQUIRED_DATABASES = [];

const OPTIONS = ['First', 'Second', 'Third'];

const palette = (dark: boolean) => ({
  canvas: dark ? '#101924' : '#f5f7fa',
  surface: dark ? '#172230' : '#ffffff',
  text: dark ? '#eef3fb' : '#172536',
  muted: dark ? '#a6b5c8' : '#526477',
  border: dark ? '#2b3b4e' : '#d5dfea',
  accent: dark ? '#61a7ff' : '#1d6cc4',
});

export default function StarterDive() {
  // The host app sets app_theme when it opens the embed session; standalone it stays light.
  const [theme] = useDiveState<'light' | 'dark'>('app_theme', 'light');
  // Any Dive state is sent to the host as dive-state-update and shown to the chat assistant.
  const [choice, setChoice] = useDiveState<string>('example_choice', OPTIONS[0]);
  const today = useSQLQuery('SELECT current_date::VARCHAR AS today');
  const colors = palette(theme === 'dark');
  const date = Array.isArray(today.data) && today.data[0] ? String(today.data[0].today) : '';

  return (
    <main style={{ minHeight: '100vh', margin: 0, padding: '48px 24px', background: colors.canvas, color: colors.text, fontFamily: 'system-ui, sans-serif' }}>
      <section style={{ maxWidth: 560, margin: '0 auto', padding: 28, border: `1px solid ${colors.border}`, borderRadius: 10, background: colors.surface }}>
        <p style={{ margin: 0, color: colors.accent, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Placeholder Dive</p>
        <h1 style={{ margin: '10px 0 0', fontSize: 28, letterSpacing: '-0.03em' }}>Replace this Dive</h1>
        <p style={{ margin: '12px 0 0', color: colors.muted, lineHeight: 1.6 }}>
          This Dive proves the embed works. Save your own Dive in MotherDuck, then point
          its entry in <code>dives.config.mjs</code> at the new Dive id and shares.
        </p>
        <p style={{ margin: '20px 0 0', fontSize: 14 }}>
          {today.isLoading ? 'Running SELECT current_date…' : today.isError ? 'The query failed.' : `MotherDuck says today is ${date}.`}
        </p>
        <fieldset style={{ margin: '20px 0 0', padding: 0, border: 0 }}>
          <legend style={{ marginBottom: 8, color: colors.muted, fontSize: 13 }}>Example state the chat can read</legend>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setChoice(option)}
                aria-pressed={choice === option}
                style={{ padding: '6px 12px', border: `1px solid ${choice === option ? colors.accent : colors.border}`, borderRadius: 6, background: choice === option ? colors.accent : 'transparent', color: choice === option ? '#ffffff' : colors.text, cursor: 'pointer', font: 'inherit', fontSize: 13 }}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>
      </section>
    </main>
  );
}
