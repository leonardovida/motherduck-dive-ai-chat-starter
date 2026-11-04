// Settings for a connection to MotherDuck's Postgres endpoint. MOTHERDUCK_PG_HOST picks the
// region; TLS certificates are always verified.
export const motherDuckConnection = ({ env = process.env, token, database, name, queryTimeout = 15000 }) => ({
  host: env.MOTHERDUCK_PG_HOST || 'pg.us-east-1-aws.motherduck.com', port: 5432, user: 'postgres', password: token, database,
  ssl: { rejectUnauthorized: true }, application_name: name, connectionTimeoutMillis: 15000, query_timeout: queryTimeout, keepAlive: true,
});
