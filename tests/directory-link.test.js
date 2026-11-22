import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { win32 } from 'node:path';
import test from 'node:test';
import { openWindowsDirectory, registerDirectoryLinkHost } from '../directory-link-host.js';
import { DIRECTORY_LINK_PATH, DIRECTORY_LINK_HEADER, localWindowsPath, parseLegacyFileLink } from '../local-link-path.js';

const path = 'D:\\个人\\Docs, old=1\\100% # sample';

test('legacy file URI parses an exact local pathname and optional line once', () => {
  for (const href of ['file:///D:/个人/Docs,%20old=1/100%25%20%23%20sample',
    'file://localhost/D:/个人/Docs,%20old=1/100%25%20%23%20sample', 'file://D:/个人/Docs,%20old=1/100%25%20%23%20sample']) {
    assert.deepEqual(parseLegacyFileLink(href + '#L12-L14'), { path, windows: true, line: 12 });
  }
  assert.deepEqual(parseLegacyFileLink('file:///tmp/a%20b'), { path: '/tmp/a b', windows: false, line: undefined });
  assert.equal(parseLegacyFileLink('file:///D:/one%2520file')?.path, 'D:\\one%20file');
  assert.equal(localWindowsPath('D:/Folder/'), 'D:\\Folder');
  for (const bad of ['file://server/share', 'file:////server/share', 'file://user@localhost/D:/x', 'file://localhost:80/D:/x',
    'file:///D:/one%2ftwo', 'file:///D:/one%5ctwo', 'file:///D:/bad%', 'file:///D:/%00', 'file:///D:/%2e%2e/file',
    'file:///D:/folder/a:b', 'file:///D:/file?query=1', 'file:///D:/x#other', 'file:///D:/x#L3-L2']) assert.equal(parseLegacyFileLink(bad), null, bad);
  for (const bad of ['D:relative', '/D:/wrong', 'D:\\..\\escape', 'D:/x/./y', 'D:/x//y', 'D:/x. ', 'D:/AUX .txt',
    'D:/com¹.txt', 'D:/x.{88DC}', 'D:/something:stream', '\\\\server\\share', '\\\\?\\D:\\path', '\\\\.\\D:\\path']) {
    assert.equal(localWindowsPath(bad), null, bad);
  }
});

function mount(open, t) {
  let route, cleanup;
  const browserPeer = { principal: { kind: 'owner' } };
  registerDirectoryLinkHost({ inject(keys, apply) {
    assert.deepEqual(keys, ['connection', 'webServer']);
    apply({
      effect(register) { cleanup = register(); },
      webServer: { register(spec) { route = spec; return () => { route = undefined; }; } },
      connection: { browserPeer, admit(req) {
        if (req.headers.cookie === 'browser') return { peer: browserPeer };
        if (req.headers.cookie === 'api') return { peer: { principal: { kind: 'owner' } } };
        return { rejection: 401 };
      } },
    });
  } }, 'win32', open);
  assert.equal(route.kind, 'exact');
  assert.equal(route.path, DIRECTORY_LINK_PATH);
  const server = createServer((req, res) => {
    if (!route) { res.writeHead(404).end(); return; }
    void route.handler(req, res);
  });
  t.after(() => { cleanup(); server.closeAllConnections(); server.close(); });
  return { server, cleanup };
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function headers(extra = {}) {
  return { 'Content-Type': 'application/json', [DIRECTORY_LINK_HEADER]: '1', Cookie: 'browser', ...extra };
}

function send(base, value, extra = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  return new Promise((resolve, reject) => {
    const req = request(base + DIRECTORY_LINK_PATH, {
      method: 'POST', headers: headers({ 'Content-Length': Buffer.byteLength(body), ...extra }),
    }, res => { res.resume(); resolve({ status: res.statusCode, headers: new Headers(res.headers) }); });
    req.on('error', reject);
    req.end(body);
  });
}

test('Host accepts only exact POST, same-origin browser Owner and genuine loopback', async t => {
  const seen = [];
  const h = mount(async (target, signal, inspect) => { seen.push({ target, signal, inspect }); return 204; }, t);
  const base = await listen(h.server);
  const desktop = await send(base, { path }); // rc.5 Desktop proxy strips Origin/Sec-Fetch-Site.
  assert.equal(desktop.status, 204);
  assert.equal(desktop.headers.get('cache-control'), 'no-store');
  assert.equal((await send(base, { path }, { Origin: base, 'Sec-Fetch-Site': 'same-origin' })).status, 204);
  for (const extra of [{ Cookie: 'api' }, { Cookie: '' }, { [DIRECTORY_LINK_HEADER]: '0' },
    { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'http://other.example' }, { 'X-Forwarded-For': '127.0.0.1' },
    { Forwarded: 'for=127.0.0.1' }, { Host: 'other.example' }]) assert.equal((await send(base, { path }, extra)).status, 403, JSON.stringify(extra));
  assert.equal((await fetch(base + DIRECTORY_LINK_PATH, { headers: headers() })).status, 405);
  assert.equal((await fetch(base + DIRECTORY_LINK_PATH + '?path=other', { method: 'POST', headers: headers() })).status, 404);
  assert.equal((await send(base, { path, action: 'open' })).status, 400);
  assert.equal((await send(base, { path: '\\\\nas\\share' })).status, 400);
  assert.equal((await send(base, 'x'.repeat(25 * 1024))).status, 413);
  assert.deepEqual(seen.map(x => [x.target, x.inspect, x.signal.aborted]), [[path, false, false], [path, false, false]]);
});

test('unload unregisters and aborts a pending directory operation', async t => {
  const entered = Promise.withResolvers();
  const h = mount(async (_target, signal) => {
    entered.resolve(signal);
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    signal.throwIfAborted();
  }, t);
  const base = await listen(h.server);
  const response = send(base, { path });
  const signal = await entered.promise;
  h.cleanup();
  assert.equal(signal.aborted, true);
  assert.equal((await response).status, 503);
  assert.equal((await send(base, { path })).status, 404);
});

test('launcher is fixed, shell-free, and accepts path only as data', async () => {
  const timer = new AbortController();
  let program;
  const run = (executable, args, options) => {
    assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(options.shell, false);
    assert.equal(options.signal, timer.signal);
    assert.equal(options.env.DSH_DIRECTORY_LINK_PATH, path);
    assert.equal(options.env.DSH_DIRECTORY_LINK_INSPECT, '1');
    assert.equal(args.some(arg => arg.includes(path)), false);
    program = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    throw Object.assign(new Error('no execution in unit test'), { code: 3 });
  };
  assert.equal(await openWindowsDirectory(path, timer.signal, true, run, 'C:\\Windows'), 200);
  assert.match(program, /DriveType[^\n]*::Fixed/);
  assert.match(program, /DriveType[^\n]*::Removable/);
  assert.match(program, /\$folder\.Self\.Path/);
  assert.match(program, /\$shell\.Explore\(\$resolved\)/);
  assert.doesNotMatch(program, /Start-Process|Invoke-Expression|ShellExecute/);
  assert.equal(await openWindowsDirectory('D:/not-canonical', timer.signal, false, run, 'C:\\Windows'), 404);
});

test('Windows integration: real fixed-drive and path classification without opening Explorer', { skip: process.platform !== 'win32' }, async () => {
  const cwd = process.cwd();
  const signal = AbortSignal.timeout(8000);
  assert.equal(await openWindowsDirectory(win32.join(cwd, 'index.js'), signal, true), 200);
  assert.equal(await openWindowsDirectory(cwd, signal, true), 404);
  assert.equal(await openWindowsDirectory(win32.join(cwd, 'index.js', 'not-a-directory'), signal, true), 404);
});
