import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  /**
   * Asserts the response ENVELOPE, not a bare string.
   *
   * This test shipped from the Nest scaffold expecting the literal
   * `'Hello World!'`, and had been failing ever since `ResponseInterceptor` was
   * registered globally to wrap every successful response in
   * `{ data, meta: { requestId, timestamp } }`. Nothing was broken — the test
   * simply described a contract the application had deliberately replaced.
   *
   * Worth keeping rather than deleting: it is the only assertion anywhere that
   * the envelope is actually applied end to end, which is a real contract the
   * entire frontend `fetchApi` unwrapping depends on.
   */
  it('/ (GET) returns the response envelope', async () => {
    const response = await request(app.getHttpServer()).get('/').expect(200);

    expect(response.body.data).toBe('Hello World!');
    expect(response.body.meta).toEqual(
      expect.objectContaining({
        requestId: expect.any(String),
        timestamp: expect.any(String),
      }),
    );
  });

  afterEach(async () => {
    await app.close();
  });
});
