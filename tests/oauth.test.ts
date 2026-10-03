// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  getAccessToken,
  importChatgptCredentials,
  oauthStatus,
  signOut,
  startOAuth,
} from '../src/core/oauth';

type Store = Record<string, unknown>;
let localData: Store;
const chromeApi = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: localData[key] })),
      set: vi.fn(async (values: Store) => {
        localData = { ...localData, ...values };
      }),
    },
  },
  identity: {
    getRedirectURL: () => 'https://abcdef.chromiumapp.org/',
    launchWebAuthFlow: vi.fn((_: { url: string }) =>
      Promise.resolve('https://abcdef.chromiumapp.org/?code=auth-code-1&state=state-1'),
    ),
  },
};
const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'));

function jwt(payload: Record<string, unknown>) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`;
}
const farFuture = Math.floor(Date.now() / 1000) + 3600;

beforeEach(() => {
  localData = {};
  vi.stubGlobal('chrome', chromeApi);
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it('imports a Codex auth.json exactly like the local CPA tool and rejects other files', async () => {
  const auth = {
    auth_mode: 'chatgpt',
    tokens: {
      access_token: jwt({
        'https://api.openai.com/auth': { chatgpt_account_id: 'acc-1' },
        exp: farFuture,
      }),
      refresh_token: 'rt-1',
      id_token: jwt({ email: 'me@example.com' }),
      account_id: 'acc-1',
    },
  };
  const result = await importChatgptCredentials(JSON.stringify(auth));
  expect(result.email).toBe('me@example.com');
  const status = await oauthStatus('chatgpt');
  expect(status).toMatchObject({ signedIn: true, email: 'me@example.com' });
  await expect(importChatgptCredentials(JSON.stringify({ auth_mode: 'api_key' }))).rejects.toThrow(
    '不是可用的 ChatGPT Codex',
  );
  await expect(importChatgptCredentials('not json')).rejects.toThrow('不是有效的 JSON');
});

it('runs the PKCE web-auth flow and exchanges the code without leaking the verifier', async () => {
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: jwt({ exp: farFuture }),
        refresh_token: 'rt-new',
        expires_in: 3600,
      }),
      { status: 200 },
    ),
  );
  chromeApi.identity.launchWebAuthFlow.mockResolvedValue(
    'https://abcdef.chromiumapp.org/?code=auth-code-2&state=state-1',
  );
  // The state must match what was put into the authorize URL; capture it from the flow URL.
  chromeApi.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
    const state = new URL(url).searchParams.get('state');
    return `https://abcdef.chromiumapp.org/?code=auth-code-2&state=${state}`;
  });
  await startOAuth('claude');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toBe('https://console.anthropic.com/v1/oauth/token');
  const body = new URLSearchParams(init!.body as string);
  expect(body.get('grant_type')).toBe('authorization_code');
  expect(body.get('code')).toBe('auth-code-2');
  expect(body.get('code_verifier')).toBeTruthy();
  expect(
    new URL(String(chromeApi.identity.launchWebAuthFlow.mock.calls[0][0].url)).searchParams.get(
      'code_challenge_method',
    ),
  ).toBe('S256');
  expect((await oauthStatus('claude')).signedIn).toBe(true);
});

it('refreshes an expiring ChatGPT token once and keeps the account id', async () => {
  const soon = Math.floor(Date.now() / 1000) + 60;
  localData = {
    easyLearnOAuthV1: {
      chatgpt: {
        accessToken: jwt({
          exp: soon,
          'https://api.openai.com/auth': { chatgpt_account_id: 'acc-old' },
        }),
        refreshToken: 'rt-old',
        expiresAt: soon * 1000,
        updatedAt: Date.now(),
      },
    },
  };
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: jwt({
          exp: farFuture,
          'https://api.openai.com/auth': { chatgpt_account_id: 'acc-old' },
        }),
        expires_in: 3600,
      }),
      { status: 200 },
    ),
  );
  const token = await getAccessToken('chatgpt');
  expect(token.accountId).toBe('acc-old');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const body = new URLSearchParams(fetcher.mock.calls[0][1]!.body as string);
  expect(body.get('grant_type')).toBe('refresh_token');
  expect(body.get('refresh_token')).toBe('rt-old');
  const stored = (localData.easyLearnOAuthV1 as { chatgpt: { expiresAt: number } }).chatgpt;
  expect(stored.expiresAt).toBeGreaterThan(Date.now() + 300000);
  // A fresh token must not trigger a second refresh.
  await getAccessToken('chatgpt');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('fails closed without a login and removes tokens on sign-out', async () => {
  await expect(getAccessToken('claude')).rejects.toThrow('尚未登录');
  localData = {
    easyLearnOAuthV1: {
      chatgpt: {
        accessToken: jwt({ exp: farFuture }),
        expiresAt: farFuture * 1000,
        updatedAt: Date.now(),
      },
    },
  };
  await signOut('chatgpt');
  expect((await oauthStatus('chatgpt')).signedIn).toBe(false);
});

it('surfaces a rejected authorization instead of storing nothing silently', async () => {
  chromeApi.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
    const state = new URL(url).searchParams.get('state');
    return `https://abcdef.chromiumapp.org/?error=access_denied&state=${state}`;
  });
  await expect(startOAuth('chatgpt')).rejects.toThrow('登录被拒绝');
  expect(fetcher).not.toHaveBeenCalled();
});
