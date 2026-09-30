import { z } from 'zod';
import { providers, providerFor } from './providers';
import { apiKinds, explanationStyles, oauthApiKinds, profileSchema, type Config } from './types';

export const PROVIDER_SETTINGS_KEY = 'providerSettingsV1';
const ids = new Set(['custom', ...providers.map(provider => provider.id)]);
// Drafts may be incomplete; validating/authorizing an active connection happens on save.
export const providerDraftSchema = z.object({
  baseUrl: z.string().max(500), model: z.string().max(150), apiKey: z.string().max(2000),
  api: z.enum(apiKinds).optional(), profile: profileSchema.extend({domain: z.string().max(80)}), style: z.enum(explanationStyles).optional(),
}).transform(draft => oauthApiKinds.includes(draft.api ?? 'openai') ? {...draft, apiKey: ''} : draft);
export type ProviderSettings = { activeProviderId: string; drafts: Record<string, Config> };

export function providerId(value: unknown, config?: Config): string {
  if (value === undefined) return config ? providerFor(config.baseUrl, config.model)?.id ?? 'custom' : 'custom';
  if (typeof value !== 'string' || !ids.has(value)) throw new Error('未知的服务方案。');
  return value;
}

export function readProviderSettings(value: unknown, config?: Config): ProviderSettings {
  const stored = value && typeof value === 'object' ? value as Partial<ProviderSettings> : {};
  const activeProviderId = typeof stored.activeProviderId === 'string' && ids.has(stored.activeProviderId)
    ? stored.activeProviderId : providerId(undefined, config);
  const drafts: Record<string, Config> = {};
  if (stored.drafts && typeof stored.drafts === 'object') for (const [id, draft] of Object.entries(stored.drafts)) {
    const parsed = providerDraftSchema.safeParse(draft);
    if (ids.has(id) && parsed.success) drafts[id] = parsed.data;
  }
  if (config && !drafts[activeProviderId]) drafts[activeProviderId] = providerDraftSchema.parse(config);
  return {activeProviderId, drafts};
}
