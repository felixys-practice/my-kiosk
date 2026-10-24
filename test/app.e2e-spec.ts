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

  // Redis·BullMQ 연결을 닫아 Jest가 종료되게 한다
  afterEach(async () => {
    await app.close();
  });

  // 전역 JwtAuthGuard가 @Public() 없는 경로에 기본 적용되는지 확인한다
  it('인증 토큰 없이 GET / 를 요청하면 401을 반환한다', () => {
    return request(app.getHttpServer()).get('/').expect(401);
  });
});
