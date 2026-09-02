import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import 'dotenv/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
const sessions = new Map();
const oauthStates = new Set();
const accountsPath = join(root, 'data/accounts.json');
const configPath = join(root, 'data/config.json');

const cookies = (request) => Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => part.trim().split('=')));
const sessionUser = (request) => sessions.get(cookies(request).lumera_session);
const json = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
};
const readConfig = async () => {
  try { return JSON.parse(await readFile(configPath, 'utf8')); } catch { return { guilds: {} }; }
};
const saveConfig = async (config) => writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
const requestBody = async (request) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
};
const readAccounts = async () => {
  try { return JSON.parse(await readFile(accountsPath, 'utf8')); } catch { return {}; }
};
const saveAccounts = async (accounts) => writeFile(accountsPath, `${JSON.stringify(accounts, null, 2)}\n`);
const passwordHash = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
const passwordMatches = (password, stored) => {
  const [salt, hash] = stored.split(':');
  return hash && timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
};
const accountSession = (account) => ({
  id: account.id,
  username: account.username,
  guilds: process.env.DISCORD_GUILD_ID ? [{ id: process.env.DISCORD_GUILD_ID, name: 'Lumera Server', icon: null }] : [],
});
const canManageGuild = (guild) => (BigInt(guild.permissions || 0) & 32n) === 32n || guild.owner;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/health') return json(response, 200, { status: 'ok', service: 'lumera-dashboard' });

  if (url.pathname === '/auth/register' && request.method === 'POST') {
    try {
      const { username, password } = await requestBody(request);
      if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username || '') || typeof password !== 'string' || password.length < 8) return json(response, 400, { error: 'اسم الحساب 3-24 حرفًا وكلمة المرور 8 أحرف على الأقل.' });
      const accounts = await readAccounts();
      if (accounts[username.toLowerCase()]) return json(response, 409, { error: 'اسم الحساب مستخدم بالفعل.' });
      const account = { id: randomUUID(), username, password: passwordHash(password) };
      accounts[username.toLowerCase()] = account;
      await saveAccounts(accounts);
      const sessionId = randomUUID();
      sessions.set(sessionId, accountSession(account));
      response.writeHead(201, { 'set-cookie': `lumera_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, 'content-type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ authenticated: true, user: accountSession(account) }));
    } catch { return json(response, 400, { error: 'بيانات التسجيل غير صحيحة.' }); }
  }

  if (url.pathname === '/auth/login' && request.method === 'POST') {
    try {
      const { username, password } = await requestBody(request);
      const account = (await readAccounts())[username?.toLowerCase()];
      if (!account || !passwordMatches(password || '', account.password)) return json(response, 401, { error: 'اسم الحساب أو كلمة المرور غير صحيحة.' });
      const sessionId = randomUUID();
      sessions.set(sessionId, accountSession(account));
      response.writeHead(200, { 'set-cookie': `lumera_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, 'content-type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ authenticated: true, user: accountSession(account) }));
    } catch { return json(response, 400, { error: 'بيانات الدخول غير صحيحة.' }); }
  }

  if (url.pathname === '/auth/discord') {
    if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET.includes('سر_التطبيق')) return json(response, 503, { error: 'أضف DISCORD_CLIENT_SECRET الحقيقي في ملف .env' });
    const state = randomUUID();
    oauthStates.add(state);
    const authUrl = new URL('https://discord.com/oauth2/authorize');
    authUrl.search = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, redirect_uri: process.env.DISCORD_REDIRECT_URI, response_type: 'code', scope: 'identify guilds', state }).toString();
    response.writeHead(302, { location: authUrl });
    return response.end();
  }

  if (url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!state || !oauthStates.delete(state) || !code) return json(response, 400, { error: 'Invalid OAuth callback' });
    try {
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: process.env.DISCORD_REDIRECT_URI }) });
      const token = await tokenResponse.json();
      if (!token.access_token) return json(response, 401, { error: 'رفض Discord تسجيل الدخول. تحقق من Client Secret وRedirect URI.' });
      const userResponse = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `${token.token_type} ${token.access_token}` } });
      const user = await userResponse.json();
      const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', { headers: { authorization: `${token.token_type} ${token.access_token}` } });
      const guilds = await guildsResponse.json();
      const sessionId = randomUUID();
      sessions.set(sessionId, { id: user.id, username: user.global_name || user.username, avatar: user.avatar, guilds: guilds.filter(canManageGuild).map(({ id, name, icon }) => ({ id, name, icon })) });
      response.writeHead(302, { location: '/', 'set-cookie': `lumera_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` });
      return response.end();
    } catch {
      return json(response, 502, { error: 'Unable to connect to Discord' });
    }
  }

  if (url.pathname === '/auth/logout') {
    sessions.delete(cookies(request).lumera_session);
    response.writeHead(302, { location: '/', 'set-cookie': 'lumera_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    return response.end();
  }

  if (url.pathname === '/api/me') return json(response, 200, { authenticated: Boolean(sessionUser(request)), user: sessionUser(request) || null });
  if (url.pathname === '/api/guilds') {
    const user = sessionUser(request);
    if (!user) return json(response, 401, { error: 'سجّل دخولك أولًا' });
    return json(response, 200, { guilds: user.guilds || [] });
  }
  if (url.pathname === '/api/shortcuts' && request.method === 'GET') {
    const user = sessionUser(request);
    const guild = user?.guilds?.find(({ id }) => id === url.searchParams.get('guild_id'));
    if (!guild) return json(response, 403, { error: 'لا تملك صلاحية إدارة هذا السيرفر' });
    const config = await readConfig();
    return json(response, 200, { shortcuts: config.guilds[guild.id]?.shortcuts || {} });
  }
  if (url.pathname === '/api/shortcuts' && request.method === 'POST') {
    const user = sessionUser(request);
    if (!user) return json(response, 401, { error: 'سجّل دخولك أولًا' });
    try {
      const body = await requestBody(request);
        const guild = user.guilds?.find(({ id }) => id === body.guildId);
      if (!guild) return json(response, 403, { error: 'لا تملك صلاحية إدارة هذا السيرفر' });
      if (!/^[\p{L}\p{N}_-]{1,20}$/u.test(body.name || '') || !['invite', 'clear', 'kick', 'ban', 'timeout', 'untimeout', 'lock', 'unlock', 'slowmode', 'warn', 'role_add', 'role_remove', 'say', 'announce', 'embed', 'serverstats'].includes(body.command)) return json(response, 400, { error: 'بيانات الاختصار غير صحيحة' });
      const config = await readConfig();
      config.guilds[guild.id] ||= { shortcuts: {} };
      config.guilds[guild.id].shortcuts[body.name.toLowerCase().replace(/^!+/, '')] = body.command;
      await saveConfig(config);
      return json(response, 200, { ok: true });
    } catch { return json(response, 400, { error: 'صيغة الطلب غير صحيحة' }); }
  }
  if (url.pathname === '/api/shortcuts' && request.method === 'DELETE') {
    const user = sessionUser(request);
    if (!user) return json(response, 401, { error: 'سجّل دخولك أولًا' });
    try {
      const body = await requestBody(request);
      const guild = user.guilds?.find(({ id }) => id === body.guildId);
      if (!guild) return json(response, 403, { error: 'لا تملك صلاحية إدارة هذا السيرفر' });
      const config = await readConfig();
      delete config.guilds[guild.id]?.shortcuts?.[body.name?.toLowerCase().replace(/^!+/, '')];
      await saveConfig(config);
      return json(response, 200, { ok: true });
    } catch { return json(response, 400, { error: 'بيانات الحذف غير صحيحة' }); }
  }
  if (url.pathname === '/api/settings' && request.method === 'GET') {
    const user = sessionUser(request);
    const guild = user?.guilds?.find(({ id }) => id === url.searchParams.get('guild_id'));
    if (!guild) return json(response, 403, { error: 'لا تملك صلاحية إدارة هذا السيرفر' });
    const config = await readConfig();
    return json(response, 200, { settings: config.guilds[guild.id]?.settings || { enabledCommands: {}, activity: { text: '', type: 'Watching' } } });
  }
  if (url.pathname === '/api/settings' && request.method === 'POST') {
    const user = sessionUser(request);
    if (!user) return json(response, 401, { error: 'سجّل دخولك أولًا' });
    try {
      const body = await requestBody(request);
      const guild = user.guilds?.find(({ id }) => id === body.guildId);
      const allowed = new Set(['help', 'ping', 'server', 'invite', 'clear', 'kick', 'ban', 'timeout', 'untimeout', 'lock', 'unlock', 'slowmode', 'warn', 'role', 'profile', 'balance', 'daily', 'quest', 'leaderboard', 'pay', 'shop', 'coinflip', 'achievement', 'title', 'mystery', 'redeem', 'redeem-create', 'level-role', 'event', 'challenge', 'season', 'welcome', 'custom-reply', 'automod', 'setup-logs']);
      if (!guild || !body.settings || typeof body.settings.enabledCommands !== 'object') return json(response, 403, { error: 'لا تملك صلاحية إدارة هذا السيرفر' });
      const enabledCommands = Object.fromEntries(Object.entries(body.settings.enabledCommands).filter(([command, enabled]) => allowed.has(command) && typeof enabled === 'boolean'));
      const config = await readConfig();
      config.guilds[guild.id] ||= {};
      const activityText = typeof body.settings.activity?.text === 'string' ? body.settings.activity.text.slice(0, 128) : '';
      const activityType = ['Playing', 'Watching', 'Listening', 'Competing'].includes(body.settings.activity?.type) ? body.settings.activity.type : 'Watching';
      config.guilds[guild.id].settings = { enabledCommands, activity: { text: activityText, type: activityType } };
      await saveConfig(config);
      return json(response, 200, { ok: true, settings: config.guilds[guild.id].settings });
    } catch { return json(response, 400, { error: 'إعدادات غير صحيحة' }); }
  }

  const requested = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': types[extname(filePath)] ?? 'text/plain; charset=utf-8' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`Lumera dashboard listening on http://localhost:${port}`));