import {
  Controller,
  Get,
  Header,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CacheControlInterceptor } from './cache-control.interceptor';

/**
 * The interceptor's whole contract is an ordering claim: that Nest applies
 * `@Header()` before an interceptor's post-handler phase, so "did a route opt
 * into caching?" can be answered by reading the header back off the response.
 * That is an assumption about framework internals, so it is asserted here
 * rather than assumed — a Nest upgrade that reorders the two would silently
 * turn every cached public endpoint into `no-store` and quietly move all form
 * traffic back onto the origin.
 */
@Controller('t')
class ProbeController {
  @Get('private')
  private_() {
    return { ok: true };
  }

  @Get('public')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  public_() {
    return { ok: true };
  }

  @Get('boom')
  boom() {
    throw new NotFoundException('nope');
  }
}

describe('CacheControlInterceptor', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('defaults an undeclared route to no-store', async () => {
    const res = await request(app.getHttpServer())
      .get('/t/private')
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('leaves a route that opted into caching alone', async () => {
    const res = await request(app.getHttpServer()).get('/t/public').expect(200);
    expect(res.headers['cache-control']).toBe(
      'public, max-age=300, stale-while-revalidate=600',
    );
  });

  it('covers error responses, which are as tenant-specific as successful ones', async () => {
    const res = await request(app.getHttpServer()).get('/t/boom').expect(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
