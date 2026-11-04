import { z } from 'zod';
import { listDives } from './dives.mjs';
import { SERVICE_ACCOUNT, parseGroupResources } from './groups.mjs';

// The group form, validated once for create and update.
export const groupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
  dives: z.union([z.literal('*'), z.array(z.string().max(40)).max(100)]),
  chat: z.boolean(),
  serviceAccount: z.union([z.literal(''), z.string().regex(SERVICE_ACCOUNT)]).optional(),
  resources: z.record(z.string(), z.array(z.object({ alias: z.string().max(100), url: z.string().max(300) })).max(20)).optional(),
  // Tokens the group's members may use in AI chat each calendar month (UTC). Empty means no limit.
  monthlyTokenCap: z.number().int().min(1000).max(1e12).nullable().optional(),
});

export function cleanGroup(body) {
  const known = new Set(listDives().map(dive => dive.key));
  return {
    name: body.name, description: body.description ?? '',
    dives: body.dives === '*' ? '*' : body.dives.filter(key => known.has(key)), chat: body.chat,
    serviceAccount: body.serviceAccount || null, monthlyTokenCap: body.monthlyTokenCap ?? null,
    // Database overrides only matter for a service account, and only for known Dives.
    resources: body.serviceAccount ? Object.fromEntries(Object.entries(parseGroupResources(body.resources ?? {})).filter(([key]) => known.has(key))) : {},
  };
}
