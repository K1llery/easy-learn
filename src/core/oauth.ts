// Subscription-account OAuth (PKCE) for personal use, run entirely inside the
// extension: tokens live in chrome.storage.local and never leave the device
// except to the identity provider and the matching model endpoint.
export type OAuthKind = 'chatgpt' | 'claude';
export type OAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  expiresAt: number;
  updatedAt: number;
};
const STORE_KEY = 'easyLearnOAuthV1';
type OAuthStore = Partial<Record<OAuthKind, OAuthTokenSet>>;
const PROVIDERS: Record<
  OAuthKind,
  { authorize: string; token: string; clientId: string; scope: string; callbackFlag?: string }
> = {
  chatgpt: {
    authorize: 'https://auth.openai.com/authorize',
    token: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scope: 'openid profile email offline_access',
  },
  claude: {
    authorize: 'https://claude.ai/oauth/authorize',
    token: 'https://console.anthropic.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944db16fa58',
    scope: 'org:create_api_key user:profile user:inference',
    callbackFlag: 'code=true',
  },
};
// Host permissions the model layer needs for subscription calls (requested at login).
export const MODEL_ORIGINS: Record<OAuthKind, string[]> = {
  chatgpt: ['https://chatgpt.com/*', 'https://auth.openai.com/*'],
  claude: ['https://api.anthropic.com/*', 'https://console.anthropic.com/*'],
};
export const LOGIN_ORIGINS: Record<OAuthKind, string[]> = {
  chatgpt: ['https://auth.openai.com/*', 'https://chatgpt.com/*'],
  claude: ['https://claude.ai/*', 'https://console.anthropic.com/*', 'https://api.anthropic.com/*'],
};
export const OAUTH_KINDS: OAuthKind[] = ['chatgpt', 'claude'];
export const KIND_LABELS: Record<OAuthKind, string> = { chatgpt: 'ChatGPT', claude: 'Claude' };

function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomToken(length = 48) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
export function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(base64 + '='.repeat((4 - (payload.length % 4)) % 4)), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
  } catch {
    return {};
  }
}
function chatgptAccountId(accessToken: string) {
  const claims = decodeJwtClaims(accessToken) as {
    'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
  };
  return claims['https://api.openai.com/auth']?.chatgpt_account_id;
}
function readStore(): Promise<OAuthStore> {
  return chrome.storage.local
    .get(STORE_KEY)
    .then((data) => (data[STORE_KEY] as OAuthStore | undefined) ?? {});
}
async function writeStore(store: OAuthStore) {
  await chrome.storage.local.set({ [STORE_KEY]: store });
}
async function readToken(kind: OAuthKind): Promise<OAuthTokenSet | undefined> {
  return (await readStore())[kind];
}
async function saveToken(kind: OAuthKind, set: OAuthTokenSet) {
  const store = await readStore();
  store[kind] = set;
  await writeStore(store);
}
function expiryFrom(token: string, fallbackSeconds: number) {
  const exp = decodeJwtClaims(token).exp;
  return typeof exp === 'number' ? exp * 1000 : Date.now() + fallbackSeconds * 1000;
}
async function exchangeToken(
  kind: OAuthKind,
  body: Record<string, string>,
): Promise<{
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}> {
  const provider = PROVIDERS[kind];
  let response: Response;
  try {
    response = await fetch(provider.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  } catch {
    throw new Error('无法连接登录服务，请检查网络后重试。');
  }
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || !payload?.access_token) {
    const detail =
      typeof payload?.error_description === 'string'
        ? payload.error_description
        : typeof payload?.error === 'string'
          ? payload.error
          : '';
    throw new Error(`登录没有完成（HTTP ${response.status}${detail ? `：${detail}` : ''}）。`);
  }
  return payload;
}
async function tokenSet(
  kind: OAuthKind,
  payload: { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number },
  previous?: OAuthTokenSet,
): Promise<OAuthTokenSet> {
  const now = Date.now();
  const set: OAuthTokenSet = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || previous?.refreshToken,
    idToken: payload.id_token || previous?.idToken,
    expiresAt: expiryFrom(payload.access_token, payload.expires_in ?? 3600),
    updatedAt: now,
  };
  if (kind === 'chatgpt') {
    set.accountId = chatgptAccountId(payload.access_token) ?? previous?.accountId;
    if (payload.id_token)
      set.email = String(decodeJwtClaims(payload.id_token).email ?? '') || previous?.email;
  }
  return set;
}
export async function startOAuth(kind: OAuthKind): Promise<{ email?: string }> {
  if (typeof chrome === 'undefined' || !chrome.identity?.launchWebAuthFlow)
    throw new Error('当前环境不支持扩展内 OAuth 登录。');
  const provider = PROVIDERS[kind];
  const redirectUri = chrome.identity.getRedirectURL();
  const verifier = randomToken();
  const challenge = await pkceChallenge(verifier);
  const state = randomToken(16);
  const url = new URL(provider.authorize);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (provider.callbackFlag)
    url.searchParams.set(provider.callbackFlag.split('=')[0], provider.callbackFlag.split('=')[1]);
  let callback: string;
  try {
    callback =
      (await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true })) ?? '';
  } catch {
    throw new Error('登录窗口没有完成授权。');
  }
  if (!callback) throw new Error('登录窗口没有完成授权。');
  const callbackUrl = new URL(callback);
  if (callbackUrl.searchParams.get('state') !== state)
    throw new Error('登录回调校验失败，请重试。');
  const error = callbackUrl.searchParams.get('error');
  if (error) throw new Error(`登录被拒绝或未完成（${error}）。`);
  const code = callbackUrl.searchParams.get('code');
  if (!code) throw new Error('登录回调中没有授权码，请重试。');
  const payload = await exchangeToken(kind, {
    grant_type: 'authorization_code',
    code,
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const set = await tokenSet(kind, payload);
  await saveToken(kind, set);
  return { email: set.email };
}
// Accepts the auth.json written by the Codex CLI; same validation as the local CPA tool.
export async function importChatgptCredentials(text: string): Promise<{ email?: string }> {
  let source: any;
  try {
    source = JSON.parse(text);
  } catch {
    throw new Error('文件内容不是有效的 JSON。');
  }
  const tokens = source?.tokens ?? {};
  const required = ['access_token', 'refresh_token', 'id_token', 'account_id'];
  if (source?.auth_mode !== 'chatgpt' || required.some((name) => !tokens[name]))
    throw new Error('所选文件不是可用的 ChatGPT Codex 登录凭据。');
  const email = String(decodeJwtClaims(tokens.id_token).email ?? '');
  const set: OAuthTokenSet = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    accountId: tokens.account_id,
    email,
    expiresAt: expiryFrom(tokens.access_token, 3600),
    updatedAt: Date.now(),
  };
  await saveToken('chatgpt', set);
  return { email };
}
export async function getAccessToken(
  kind: OAuthKind,
): Promise<{ token: string; accountId?: string }> {
  const existing = await readToken(kind);
  if (!existing?.accessToken)
    throw new Error(`尚未登录 ${KIND_LABELS[kind]} 订阅账户，请到设置中登录。`);
  if (existing.expiresAt - Date.now() > 300_000)
    return { token: existing.accessToken, accountId: existing.accountId };
  if (!existing.refreshToken) throw new Error('登录状态已过期，请到设置中重新登录。');
  const payload = await exchangeToken(kind, {
    grant_type: 'refresh_token',
    refresh_token: existing.refreshToken,
    client_id: PROVIDERS[kind].clientId,
  });
  const set = await tokenSet(kind, payload, existing);
  await saveToken(kind, set);
  return { token: set.accessToken, accountId: set.accountId };
}
export async function oauthStatus(
  kind: OAuthKind,
): Promise<{ signedIn: boolean; email?: string; expiresAt?: number }> {
  const set = await readToken(kind);
  return set?.accessToken
    ? { signedIn: true, email: set.email, expiresAt: set.expiresAt }
    : { signedIn: false };
}
export async function signOut(kind: OAuthKind): Promise<null> {
  const store = await readStore();
  delete store[kind];
  await writeStore(store);
  return null;
}
