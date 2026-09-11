export function json(response, status, payload, headers = {}) { response.statusCode = status; response.setHeader('content-type', 'application/json; charset=utf-8'); for (const [key, value] of Object.entries(headers)) response.setHeader(key, value); response.end(JSON.stringify(payload)); }
export function cookies(request) { return Object.fromEntries((request.headers.cookie ?? '').split(';').filter(Boolean).map(value => value.trim().split('='))); }
export function isAdmin(request) { return !process.env.ADMIN_TOKEN || cookies(request).monitor_token === encodeURIComponent(process.env.ADMIN_TOKEN); }
export function body(request) { return new Promise(resolve => { let raw = ''; request.on('data', chunk => raw += chunk); request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } }); }); }
export function cronAuthorized(request) { return Boolean(process.env.CRON_SECRET) && request.headers.authorization === `Bearer ${process.env.CRON_SECRET}`; }
