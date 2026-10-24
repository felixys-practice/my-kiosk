import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { RedisService } from 'src/database/redis/redis.service';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    // UserService가 주입받는 의존 대상은 빈 모의 객체로 대체한다
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: ConfigService, useValue: {} },
        { provide: UserRepository, useValue: {} },
        { provide: RedisService, useValue: {} },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
