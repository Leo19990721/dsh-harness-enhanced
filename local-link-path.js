export const DIRECTORY_LINK_PATH = '/api/harness-enhanced/open-directory';
export const DIRECTORY_LINK_HEADER = 'x-dsh-harness-directory';
const unsafeWindowsName = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³]) *(?:\.|$)/iu;
const controls = /[\u0000-\u001f\u007f]/u;

// Validate before calling any filesystem API. No base directory, URL parser,
// dot-segment resolution, alias expansion, or shell namespace interpretation.
export function localWindowsPath(value) {
  if (typeof value !== 'string' || value.length > 4096 || !value.isWellFormed() || !/^[a-z]:[/\\]/i.test(value)
    || controls.test(value) || /[<>"|?*:]/u.test(value.slice(2))) return null;
  const path = value.replaceAll('/', '\\');
  const root = path.slice(0, 3);
  if (path === root) return path;
  const parts = path.slice(3).replace(/\\$/, '').split('\\');
  if (parts.some(part => part === '' || /[. ]$/u.test(part) || unsafeWindowsName.test(part)
    || /\.\{[^{}]+\}$/u.test(part))) return null;
  return root + parts.join('\\');
}

// Do not let WHATWG file-URL normalization silently change the authored target.
// Split scheme, authority, pathname and the optional DSH line fragment first.
export function parseLegacyFileLink(href) {
  if (typeof href !== 'string' || href.length > 8192 || /[\\?]/u.test(href) || controls.test(href)) return null;
  const match = /^file:\/\/(?:(?:localhost)?(\/(?!\/)[^#]*)|([a-z]:\/[^#]*))(?:#(L[1-9]\d*)(?:-L([1-9]\d*))?)?$/iu.exec(href);
  if (!match) return null;
  const encoded = match[1] ?? match[2];
  if (/%(?:2f|5c)/iu.test(encoded)) return null;
  let path;
  try { path = decodeURIComponent(encoded); } catch { return null; }
  if (!path.startsWith('/')) path = `/${path}`;
  if (controls.test(path) || !path.isWellFormed()) return null;
  const windows = /^\/[a-z]:[/\\]/i.test(path);
  if (windows) path = localWindowsPath(path.slice(1));
  else if (path.includes('\\') || /^\/[a-z]:/i.test(path)
    || path.split('/').slice(1, path.endsWith('/') ? -1 : undefined).some(p => p === '' || p === '.' || p === '..')) return null;
  if (path === null) return null;
  const line = match[3] === undefined ? undefined : Number(match[3].slice(1));
  const last = match[4] === undefined ? line : Number(match[4]);
  if (line !== undefined && (!Number.isSafeInteger(line) || !Number.isSafeInteger(last) || last < line)) return null;
  return { path, windows, line };
}

export function isLocalIpv4(address) {
  return typeof address === 'string' && /^127(?:\.\d{1,3}){3}$/.test(address)
    && address.split('.').every(part => Number(part) <= 255);
}
