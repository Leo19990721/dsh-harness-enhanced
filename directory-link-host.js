import { execFile } from 'node:child_process';
import { Socket, isIPv4 } from 'node:net';
import { win32 } from 'node:path';
import { promisify } from 'node:util';
import { DIRECTORY_LINK_HEADER, DIRECTORY_LINK_PATH, isLocalIpv4, localWindowsPath } from './local-link-path.js';

const MAX_BODY = 24 * 1024 + 64;
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const postOnly = { Allow: 'POST' };
const forwardingHeaders = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto', 'x-real-ip'];

function loopback(address) {
  if (typeof address !== 'string') return false;
  const ip = address.toLowerCase();
  if (ip === '::1') return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return isIPv4(v4) && isLocalIpv4(v4);
}

function localBrowser(req, connection) {
  // Use the original Node socket, never forwarded/IP headers or a Fetch-shaped
  // request. Worker/Remote carriers do not supply this loopback socket witness.
  if (!(req.socket instanceof Socket) || !loopback(req.socket.remoteAddress)
    || !loopback(req.socket.localAddress)) return false;
  const headers = req.headers;
  const host = headers.host;
  if (typeof host !== 'string' || !/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::[1-9]\d{0,4})?$/i.test(host)
    || forwardingHeaders.some(name => headers[name] !== undefined)) return false;
  // Desktop's owned dsh-app bridge strips Origin and Sec-Fetch-Site and injects
  // its authenticated browser cookie. A browser web POST must be same-origin;
  // both carriers need the custom header (not expressible by forms/navigation).
  const origin = headers.origin;
  const site = headers['sec-fetch-site'];
  if ((site !== undefined && site !== 'same-origin')
    || (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`)
    || (site === 'same-origin' && origin === undefined)
    || headers[DIRECTORY_LINK_HEADER] !== '1') return false;
  const peer = connection.admit(req).peer;
  return peer !== undefined && peer === connection.browserPeer && peer.principal?.kind === 'owner';
}

function readBody(req, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const end = () => finish(() => resolve(Buffer.concat(chunks, size)));
    const fail = () => finish(() => reject(new Error('request aborted')));
    const data = chunk => {
      size += chunk.byteLength;
      if (size > MAX_BODY) finish(() => resolve(null));
      else chunks.push(chunk);
    };
    function finish(callback) {
      req.off('data', data);
      req.off('end', end);
      req.off('error', fail);
      signal.removeEventListener('abort', fail);
      req.pause();
      callback();
    }
    if (signal.aborted) return reject(new Error('request aborted'));
    req.on('data', data);
    req.once('end', end);
    req.once('error', fail);
    signal.addEventListener('abort', fail, { once: true });
  });
}

// This script is constant. The path is data, not a command, URL, switch, or
// script fragment. Shell.Application.Explore navigates a dedicated folder
// window; unlike associated-file open, it is not an arbitrary program launcher.
const verifyAndExplore = `
$ErrorActionPreference = 'Stop'
$p = $env:DSH_DIRECTORY_LINK_PATH
$driveType = [IO.DriveInfo]::new($p.Substring(0,3)).DriveType
if ($driveType -ne [IO.DriveType]::Fixed -and $driveType -ne [IO.DriveType]::Removable) { exit 4 }
try {
  $attrs = [IO.File]::GetAttributes($p)
  if (-not ($attrs -band [IO.FileAttributes]::Directory)) {
    if (-not ($attrs -band [IO.FileAttributes]::Device)) { exit 3 }
    exit 4
  }
} catch { exit 4 }
if ($env:DSH_DIRECTORY_LINK_INSPECT -eq '1') { exit 4 }
$shell = New-Object -ComObject Shell.Application
$folder = $shell.NameSpace($p)
if ($null -eq $folder -or -not $folder.Self.IsFileSystem -or -not $folder.Self.IsFolder) { exit 4 }
$resolved = $folder.Self.Path
if (-not $resolved -or $resolved.Length -lt 3) { exit 4 }
$rDrive = [IO.DriveInfo]::new($resolved.Substring(0,3)).DriveType
if ($rDrive -ne [IO.DriveType]::Fixed -and $rDrive -ne [IO.DriveType]::Removable) { exit 4 }
$shell.Explore($resolved)
`;

export async function openWindowsDirectory(path, signal, inspect, run = promisify(execFile), systemRoot = process.env.SystemRoot) {
  const root = localWindowsPath(systemRoot);
  if (root === null || localWindowsPath(path) !== path) return 404;
  const executable = win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  signal.throwIfAborted();
  try {
    await run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(verifyAndExplore, 'utf16le').toString('base64')], {
      cwd: win32.dirname(executable), shell: false, windowsHide: true, signal,
      env: { ...process.env, DSH_DIRECTORY_LINK_PATH: path, DSH_DIRECTORY_LINK_INSPECT: inspect ? '1' : '0' },
    });
    signal.throwIfAborted();
    return 204;
  } catch (error) {
    signal.throwIfAborted();
    if (error?.code === 3) return 200; // Regular file: only the native in-product preview may use this.
    if (error?.code === 4) return 404;
    throw error;
  }
}

export function registerDirectoryLinkHost(ctx, platform = process.platform, open = openWindowsDirectory) {
  if (platform !== 'win32') return;
  ctx.inject(['connection', 'webServer'], scope => {
    const lifetime = new AbortController();
    let inFlight = 0;
    scope.effect(() => {
      const dispose = scope.webServer.register({
        kind: 'exact', path: DIRECTORY_LINK_PATH,
        async handler(req, res) {
          const reply = (status, headers) => {
            if (res.destroyed || res.writableEnded) return;
            res.writeHead(status, { ...noStore, ...headers });
            res.end();
          };
          if (req.url !== DIRECTORY_LINK_PATH) return reply(404);
          if (req.method !== 'POST') return reply(405, postOnly);
          if (lifetime.signal.aborted) return reply(503);
          if (!localBrowser(req, scope.connection)) return reply(403, { Connection: 'close' });
          if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) return reply(415, { Connection: 'close' });
          if (Number(req.headers['content-length']) > MAX_BODY) return reply(413, { Connection: 'close' });
          if (inFlight >= 2) return reply(503, { Connection: 'close' });

          const request = new AbortController();
          const disconnected = () => { if (!res.writableEnded) request.abort(); };
          res.once('close', disconnected);
          const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(6000)]);
          inFlight++;
          try {
            const data = await readBody(req, signal);
            signal.throwIfAborted();
            if (data === null) return reply(413, { Connection: 'close' });
            let body;
            try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { return reply(400); }
            if (!body || !Object.hasOwn(body, 'path') || Object.keys(body).some(k => k !== 'path' && k !== 'inspect')
              || (body.inspect !== undefined && body.inspect !== true)) return reply(400);
            const path = localWindowsPath(body.path);
            if (path === null) return reply(400);
            const result = await open(path, signal, body.inspect === true);
            signal.throwIfAborted();
            return reply(result);
          } catch {
            return reply(503, { Connection: 'close' });
          } finally {
            inFlight--;
            res.off('close', disconnected);
          }
        },
      });
      return () => { lifetime.abort(); dispose(); };
    }, 'harness-enhanced: local directory route');
  });
}
