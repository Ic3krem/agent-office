// Pure: how to show a view in an already-open office window. Off the office page (e.g. on /town) the hash alone does nothing, so reload '/'.
// A view may also be a scene (town step 2): 'scene=office|kain|games'; any other scene opens the plain office.
export function officeNav(currentUrl, view) {
  let p = '/'; try { p = new URL(currentUrl).pathname; } catch {}
  if (/^scene=/.test(view || '') && !/^scene=(office|kain|games)$/.test(view)) view = '';
  return p !== '/' ? { load: true, hash: view || '' } : { hash: view || '' };
}
