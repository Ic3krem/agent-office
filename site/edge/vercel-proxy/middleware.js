// Front proxy for the download counter's custom domain (dl.bmos.website on Vercel).
// Vercel serves the domain; the counter itself is the Cloudflare Worker in ../worker.js. Requests are passed on with
// the visitor's IP and country as Vercel saw them (x-real-ip, x-vercel-ip-country, both set by Vercel, not the client),
// signed with PROXY_KEY so the Worker trusts only this proxy. Nothing is logged or stored here.
// Env (set in Vercel, never committed): WORKER_ORIGIN (https://<worker>.workers.dev), PROXY_KEY (same as the Worker secret).
export const config = { matcher: '/:path*' };

export default async function middleware(request) {
  const url = new URL(request.url);
  // Anything that is not the counter (the bare domain, a typo) goes to the website, keeping the page path.
  if (!/^\/(stats|dl\/[a-z0-9-]{1,32})\/?$/.test(url.pathname)) {
    const page = /^\/[A-Za-z0-9._\/-]{0,200}$/.test(url.pathname) ? url.pathname.replace(/^\//, '') : '';
    return Response.redirect('https://tiroagents.bmos.website/' + page, 308);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD, OPTIONS' } });
  const headers = new Headers();
  for (const h of ['user-agent', 'origin', 'access-control-request-method']) { const v = request.headers.get(h); if (v) headers.set(h, v); }
  headers.set('x-proxy-key', process.env.PROXY_KEY || '');
  headers.set('x-client-ip', request.headers.get('x-real-ip') || '');
  headers.set('x-client-country', request.headers.get('x-vercel-ip-country') || '');
  const r = await fetch(process.env.WORKER_ORIGIN + url.pathname, { method: request.method, headers, redirect: 'manual' });
  return new Response(request.method === 'HEAD' ? null : r.body, { status: r.status, headers: r.headers });
}
