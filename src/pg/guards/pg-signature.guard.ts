import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import {
  PgCallbackExpiredError,
  PgCallbackFormatInvalidError,
  PgCallbackUnauthorizedError,
} from '../errors/pg-callback.error';

/** 십진 Unix 초 */
const decimalSeconds = /^\d+$/;

/** 서명 검증에 쓰는 요청 정보(rawBody는 NestFactory의 rawBody:true로 확보한 파싱 전 바이트) */
type SignedRequest = {
  method: string;
  path: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
};

/**
 * PG 콜백 서명 가드 (환불 명세 API 계약 §7)
 * - 사용자 JWT 대신 PG가 공유 비밀값으로 서명한 요청만 통과시킨다
 * - canonical = "v1\n{timestamp}\nPOST\n{path}\n{sha256(rawBody)}", 서명 = "v1=" + hex(HMAC-SHA256(secret, canonical))
 */
@Injectable()
export class PgSignatureGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  /**
   * 콜백 요청의 서명을 확인한다
   * @param context 실행 컨텍스트
   * @returns 서명이 맞으면 true
   * @throws PgCallbackUnauthorizedError 서명이 없거나 일치하지 않을 때(401)
   * @throws PgCallbackExpiredError 서명 시각이 허용 범위를 벗어났을 때(401)
   * @throws PgCallbackFormatInvalidError 압축 본문·query string일 때(400)
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SignedRequest>();
    // 압축 본문과 query string은 서명 대상 규격 밖이므로 형식 오류로 거절한다
    const encoding = request.headers['content-encoding'];
    if (
      (encoding !== undefined && encoding !== 'identity') ||
      request.originalUrl.includes('?')
    ) {
      throw new PgCallbackFormatInvalidError();
    }
    const timestamp = request.headers['x-pg-timestamp'];
    const signature = request.headers['x-pg-signature'];
    // 서명 시각은 십진 Unix 초여야 한다(형식이 틀리면 인증 실패)
    if (
      typeof timestamp !== 'string' ||
      typeof signature !== 'string' ||
      !decimalSeconds.test(timestamp)
    ) {
      throw new PgCallbackUnauthorizedError();
    }

    // 서버 시각과 서명 시각의 차이가 허용 범위(기본 300초)를 넘으면 이미 처리한 통보라도 거절한다
    const maxSkewSeconds = this.configService.get<number>(
      'pgCallback.maxSkewSeconds',
    )!;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > maxSkewSeconds) {
      throw new PgCallbackExpiredError();
    }

    // 파싱 전 원문 바이트로 계산한 서명과 상수 시간으로 비교한다(JSON 재직렬화 바디를 쓰지 않는다)
    const bodyHash = createHash('sha256')
      .update(request.rawBody ?? Buffer.alloc(0))
      .digest('hex');
    const canonical = `v1\n${timestamp}\n${request.method}\n${request.path}\n${bodyHash}`;
    const expected = Buffer.from(
      `v1=${createHmac('sha256', this.secret()).update(canonical, 'utf8').digest('hex')}`,
      'utf8',
    );
    const received = Buffer.from(signature, 'utf8');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new PgCallbackUnauthorizedError();
    }
    return true;
  }

  /**
   * 공유 서명 비밀값을 읽는다(로그에 남기지 않는다)
   * @returns PG_CALLBACK_SECRET
   */
  private secret(): string {
    return this.configService.get<string>('pgCallback.secret')!;
  }
}
