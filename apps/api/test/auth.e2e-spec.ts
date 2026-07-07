import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapApp, loginBody, promoteToRole } from './helpers';

describe('auth (e2e)', () => {
  let app: INestApplication;
  let server: import('http').Server;

  beforeAll(async () => {
    app = await bootstrapApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  const uniqueUser = () => {
    const id = randomUUID().slice(0, 8);
    return { email: `auth-${id}@fiq.test`, username: `auth_${id}`, password: 'Passw0rdX!' };
  };

  it('registers a user, sets an httpOnly refresh cookie, and never returns it in the body', async () => {
    const user = uniqueUser();
    const res = await request(server).post('/api/v1/auth/register').send(user).expect(201);

    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeUndefined();

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookie = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
    expect(cookie).toContain('fiq_rt=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=strict');
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  it('rejects a duplicate email with 409', async () => {
    const user = uniqueUser();
    await request(server).post('/api/v1/auth/register').send(user).expect(201);
    const res = await request(server).post('/api/v1/auth/register').send(user).expect(409);
    expect(res.body.code).toBe('ALREADY_EXISTS');
  });

  it('rejects an unknown identifier and a wrong password identically (no account enumeration)', async () => {
    const user = uniqueUser();
    await request(server).post('/api/v1/auth/register').send(user).expect(201);

    const wrongPassword = await request(server)
      .post('/api/v1/auth/login')
      .send({ identifier: user.email, password: 'WrongPassword1!' })
      .expect(401);
    const unknownUser = await request(server)
      .post('/api/v1/auth/login')
      .send({ identifier: 'nobody-here@fiq.test', password: 'WrongPassword1!' })
      .expect(401);

    expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknownUser.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('rotates the refresh cookie and detects reuse of a consumed token', async () => {
    const user = uniqueUser();
    await request(server).post('/api/v1/auth/register').send(user).expect(201);
    const first = await request(server).post('/api/v1/auth/login').send(loginBody(user)).expect(200);
    const cookie1 = String(first.headers['set-cookie']);

    // Rotate once — succeeds, issues a new cookie.
    const rotated = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie1)
      .send({})
      .expect(200);
    expect(rotated.body.accessToken).toBeTypeOf('string');
    const cookie2 = String(rotated.headers['set-cookie']);
    expect(cookie2).not.toEqual(cookie1);

    // Replaying the OLD (now-consumed) cookie must be rejected as reuse.
    const replay = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie1)
      .send({})
      .expect(401);
    expect(replay.body.code).toBe('REFRESH_TOKEN_REUSE');

    // Reuse detection burns the whole family — the SECOND (valid-looking) cookie is dead too.
    const secondAfterReuse = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie2)
      .send({})
      .expect(401);
    expect(secondAfterReuse.body.code).toBe('REFRESH_TOKEN_REUSE');
  });

  it('mobile clients (X-Client: mobile) receive the refresh token in the body', async () => {
    const user = uniqueUser();
    await request(server).post('/api/v1/auth/register').send(user).expect(201);
    const res = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Client', 'mobile')
      .send(loginBody(user))
      .expect(200);
    expect(res.body.refreshToken).toBeTypeOf('string');
  });

  it('logout revokes the session — the presented cookie no longer refreshes', async () => {
    const user = uniqueUser();
    await request(server).post('/api/v1/auth/register').send(user).expect(201);
    const login = await request(server).post('/api/v1/auth/login').send(loginBody(user)).expect(200);
    const cookie = String(login.headers['set-cookie']);

    await request(server).post('/api/v1/auth/logout').set('Cookie', cookie).send({}).expect(204);
    await request(server).post('/api/v1/auth/refresh').set('Cookie', cookie).send({}).expect(401);
  });

  it('protected routes 401 without a token, admin routes 403 for a plain USER', async () => {
    const user = uniqueUser();
    const register = await request(server).post('/api/v1/auth/register').send(user).expect(201);
    const token = register.body.accessToken as string;

    await request(server).get('/api/v1/users/me').expect(401);
    await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(server)
      .get('/api/v1/admin/reports/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('SUPER_ADMIN passes every role check without being explicitly listed', async () => {
    const user = uniqueUser();
    const register = await request(server).post('/api/v1/auth/register').send(user).expect(201);
    const me = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .expect(200);

    await promoteToRole(app, me.body.id, 'SUPER_ADMIN');
    // Old access token still carries the stale role claim (by design — JWTs
    // are stateless); logging in again mints one with the updated role.
    const relogin = await request(server).post('/api/v1/auth/login').send(loginBody(user)).expect(200);
    await request(server)
      .get('/api/v1/admin/reports/overview')
      .set('Authorization', `Bearer ${relogin.body.accessToken}`)
      .expect(200);
  });
});
