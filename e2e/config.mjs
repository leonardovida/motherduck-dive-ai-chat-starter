// Fixed values shared by the launcher and the tests. Nothing here is a real credential.
export const E2E = {
  appPort: 3210, apiPort: 3211, modelPort: 3212,
  password: 'e2e-shared-password',
  title: 'E2E workspace',
  embedToken: 'e2e-embed-token',
  dives: { overview: '11111111-1111-4111-8111-111111111111', explorer: '22222222-2222-4222-8222-222222222222' },
};
export const APP_URL = `http://localhost:${E2E.appPort}`;
export const API_URL = `http://127.0.0.1:${E2E.apiPort}`;
