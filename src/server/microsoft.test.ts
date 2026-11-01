import { afterEach, describe, expect, it } from 'vitest';
import { authorizeUrl, msConfig, newAttempt, safeNext } from './microsoft';

describe('safeNext', () => {
  it('keeps same-site paths only', () => {
    expect(safeNext('/projects/3?tab=qa')).toBe('/projects/3?tab=qa');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('msConfig / authorizeUrl', () => {
  afterEach(() => { delete process.env.MICROSOFT_CLIENT_ID; delete process.env.MICROSOFT_CLIENT_SECRET; delete process.env.MICROSOFT_TENANT_ID; });
  it('is off until client id, secret and tenant are all set', () => {
    expect(msConfig()).toBeNull();
    process.env.MICROSOFT_CLIENT_ID = 'cid';
    process.env.MICROSOFT_CLIENT_SECRET = 'sec';
    expect(msConfig()).toBeNull();
    process.env.MICROSOFT_TENANT_ID = 'tid';
    expect(msConfig()).toMatchObject({ clientId: 'cid' });
  });
  it('asks for the code flow with PKCE, state and nonce', () => {
    const a = newAttempt('/x');
    const u = new URL(authorizeUrl({ clientId: 'cid', clientSecret: 's', tenant: 'tid', redirectUri: 'http://l/cb' }, a));
    expect(u.pathname).toBe('/tid/oauth2/v2.0/authorize');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe(a.state);
    expect(u.searchParams.get('nonce')).toBe(a.nonce);
    expect(u.searchParams.get('code_challenge')).not.toBe(a.verifier);
  });
});
