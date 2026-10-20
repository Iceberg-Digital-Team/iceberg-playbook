// Signed tokens (HS256): access, refresh and short-lived storage download tokens.
import { jwtVerify, SignJWT } from 'jose';
import { config } from './config.ts';

const key = new TextEncoder().encode(config.jwtSecret);

export type TokenUse = 'access' | 'refresh' | 'storage';

export interface TokenPayload {
  sub?: string;
  email?: string;
  bucket?: string;
  path?: string;
}

async function sign(use: TokenUse, payload: TokenPayload, ttlSeconds: number): Promise<string> {
  return new SignJWT({ ...payload, token_use: use, role: use === 'access' ? 'authenticated' : undefined })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export const signAccessToken = (sub: string, email: string) =>
  sign('access', { sub, email }, config.accessTokenTtlSeconds);

export const signRefreshToken = (sub: string, email: string) =>
  sign('refresh', { sub, email }, config.refreshTokenTtlSeconds);

export const signStorageToken = (bucket: string, path: string, ttlSeconds: number) =>
  sign('storage', { bucket, path }, ttlSeconds);

export async function verifyToken(token: string, use: TokenUse): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    if (payload.token_use !== use) return null;
    return payload as TokenPayload;
  } catch {
    return null;
  }
}
