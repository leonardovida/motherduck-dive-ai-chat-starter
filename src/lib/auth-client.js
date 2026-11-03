import { createAuthClient } from "better-auth/react";
import { adminClient, usernameClient } from "better-auth/client/plugins";

// Browser client for accounts mode. Every call goes to this app's /api/account endpoints.
export const authClient = createAuthClient({ basePath: "/api/account", plugins: [usernameClient(), adminClient()] });
