// Pure: how to show a view in an already-open office window. Off the office page (e.g. on /town) the hash alone does nothing, so reload '/'.
export function officeNav(currentUrl, view) {
  let p = '/'; try { p = new URL(currentUrl).pathname; } catch {}
  return p !== '/' ? { load: true, hash: view || '' } : { hash: view || '' };
}
