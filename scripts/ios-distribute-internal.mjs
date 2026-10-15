#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const BASE = 'https://api.appstoreconnect.apple.com/v1/';
export function ascUrl(path) {
  const url = new URL(path, BASE);
  if (url.origin !== new URL(BASE).origin || !url.pathname.startsWith('/v1/')) {
    throw new Error('ASC pagination left the expected API');
  }
  return url;
}

export function createAscRequest(env = process.env, transport = fetch) {
  return async (method, path, body, timeoutMs) => {
    const url = ascUrl(path);
    for (const name of ['ASC_KEY_ID', 'ASC_ISSUER_ID']) {
      if (!env[name]) throw new Error(`missing ${name}`);
    }
    const key = env.ASC_KEY_PATH ? readFileSync(env.ASC_KEY_PATH, 'utf8')
      : env.ASC_KEY_BASE64 ? Buffer.from(env.ASC_KEY_BASE64, 'base64').toString('utf8') : null;
    if (!key) throw new Error('missing ASC_KEY_PATH or ASC_KEY_BASE64');
    const now = Math.floor(Date.now() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' })}.${encode({
      iss: env.ASC_ISSUER_ID, iat: now - 5, exp: now + 600, aud: 'appstoreconnect-v1',
    })}`;
    const signature = sign('sha256', Buffer.from(unsigned), {
      key, dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    const response = await transport(url, {
      method, signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${unsigned}.${signature}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Do not print Apple response bodies, request headers or private key data.
    if (!response.ok) throw new Error(`ASC ${method} ${url.pathname} HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}

export async function distributeInternalBuild({
  request, buildNumber, bundleId = 'top.vansin.agentnetwork',
  waitMs = 15 * 60_000, pollMs = 10_000, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log,
}) {
  if (!/^\d+$/.test(buildNumber)) throw new Error('build number must be numeric');
  const deadline = now() + waitMs;
  const remaining = () => {
    const ms = deadline - now();
    if (ms <= 0) throw new Error(`TestFlight distribution timed out for build ${buildNumber}`);
    return ms;
  };
  const call = (method, path, body) => request(method, ascUrl(path).href, body, Math.min(20_000, remaining()));
  const pause = () => sleep(Math.min(pollMs, remaining()));
  const list = async path => {
    const rows = [];
    const seen = new Set();
    while (path) {
      const url = ascUrl(path).href;
      if (seen.has(url) || seen.size >= 200) throw new Error('ASC pagination did not complete');
      seen.add(url);
      const page = await call('GET', url);
      if (!Array.isArray(page?.data)) throw new Error('ASC list response is malformed');
      rows.push(...page.data);
      path = page.links?.next;
    }
    return rows;
  };
  const apps = (await list(`apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=200`))
    .filter(app => app.attributes?.bundleId === bundleId);
  if (apps.length !== 1 || !apps[0].id) throw new Error('ASC app identity is missing or ambiguous');
  const appId = encodeURIComponent(apps[0].id);
  let build;
  for (;;) {
    const matches = (await list(`builds?filter[app]=${appId}&filter[version]=${buildNumber}&limit=200`))
      .filter(row => row.attributes?.version === buildNumber);
    if (matches.length > 1) throw new Error('ASC build identity is ambiguous');
    build = matches[0];
    if (build?.attributes.expired === true) throw new Error('ASC build is expired');
    const state = build?.attributes.processingState;
    if (state === 'FAILED' || state === 'INVALID') throw new Error(`ASC build processing ${state}`);
    if (state === 'VALID' && build.id) {
      if (build.attributes.expired !== false) throw new Error('ASC build expiration is unknown');
      break;
    }
    log(`Waiting for TestFlight build ${buildNumber}: ${state ?? 'not visible'}`);
    await pause();
  }
  const groups = (await list(`betaGroups?filter[app]=${appId}&limit=200`))
    .filter(group => group.attributes?.isInternalGroup === true);
  if (!groups.length) throw new Error('No internal TestFlight group exists');
  const result = [];
  for (const group of groups) {
    const automatic = group.attributes.hasAccessToAllBuilds;
    if (!group.id || typeof automatic !== 'boolean') throw new Error('Internal group flags are unknown');
    const path = `betaGroups/${encodeURIComponent(group.id)}/relationships/builds`;
    const contains = async () => (await list(`${path}?limit=200`)).some(row => row.id === build.id);
    const already = await contains();
    if (!already && !automatic) {
      await call('POST', path, { data: [{ type: 'builds', id: build.id }] });
    }
    // All-build groups cannot accept explicit attachments. Wait for Apple's
    // automatic membership; ordinary groups must confirm our explicit POST.
    let confirmed = already;
    while (!confirmed) {
      await pause();
      confirmed = await contains();
    }
    result.push({ groupId: group.id, mode: automatic ? 'automatic' : already ? 'already-attached' : 'attached' });
  }
  log(`TestFlight build ${buildNumber} confirmed in ${result.length} internal groups`);
  return { buildNumber, groups: result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await distributeInternalBuild({ request: createAscRequest(), buildNumber: process.argv[2] ?? '' });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
