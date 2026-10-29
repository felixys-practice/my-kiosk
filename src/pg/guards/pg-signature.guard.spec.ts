import { createHash, createHmac } from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgSignatureGuard } from './pg-signature.guard';

describe('PgSignatureGuard', () => {
  /** 테스트용 공유 서명 비밀값(32자 이상) */
  const secret = 'test-pg-callback-secret-32-chars!';
  /** 서명 대상 콜백 경로 */
  const path = '/refund/callback';
  /** 기준 시각(Unix 초) */
  const nowSeconds = 1_800_000_000;
  /** PG가 보낸 원문 본문 */
  const body = '{"success":true,"paymentCancelId":"pc-1","amount":5000}';

  /** 콜백 서명 시각 오차 허용(초, 설정 기본값) */
  const maxSkewSeconds = 300;
  const settings: Record<string, unknown> = {
    'pgCallback.secret': secret,
    'pgCallback.maxSkewSeconds': maxSkewSeconds,
  };
  const guard = new PgSignatureGuard({
    get: (key: string) => settings[key],
  } as unknown as ConfigService);

  /**
   * 계약 §7 규격으로 서명한다
   * @param timestamp 서명 시각(Unix 초)
   * @param raw 원문 본문
   * @returns X-PG-Signature 값
   */
  function sign(timestamp: number, raw: string): string {
    const bodyHash = createHash('sha256').update(raw, 'utf8').digest('hex');
    const canonical = `v1\n${timestamp}\nPOST\n${path}\n${bodyHash}`;
    return `v1=${createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')}`;
  }

  /**
   * 콜백 요청을 담은 실행 컨텍스트를 만든다
   * @param request.headers 헤더 이름·값 목록(같은 이름을 여러 번 넣으면 중복 헤더)
   * @param request.raw 원문 본문
   * @param request.url 요청 URL(기본 서명 대상 경로)
   * @returns 실행 컨텍스트
   */
  function contextOf(request: {
    headers: [string, string][];
    raw?: string;
    url?: string;
  }): ExecutionContext {
    const headers: Record<string, string> = {};
    for (const [name, value] of request.headers) {
      const key = name.toLowerCase();
      headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
    }
    const url = request.url ?? path;
    const http = {
      method: 'POST',
      path: url.split('?')[0],
      url,
      originalUrl: url,
      headers,
      rawHeaders: request.headers.flat(),
      rawBody: Buffer.from(request.raw ?? body, 'utf8'),
    };
    return {
      switchToHttp: () => ({ getRequest: () => http }),
    } as unknown as ExecutionContext;
  }

  /**
   * 서명한 요청의 헤더를 만든다
   * @param timestamp 서명 시각
   * @param signature 서명(기본 올바른 서명)
   * @returns 헤더 목록
   */
  function signedHeaders(
    timestamp = nowSeconds,
    signature = sign(timestamp, body),
  ): [string, string][] {
    return [
      ['Content-Type', 'application/json'],
      ['X-PG-Timestamp', String(timestamp)],
      ['X-PG-Signature', signature],
    ];
  }

  /**
   * 가드 판정 결과를 통과 여부 또는 오류 코드로 바꾼다
   * @param context 실행 컨텍스트
   * @returns 통과면 'PASS', 거절이면 오류 코드
   */
  function outcomeOf(context: ExecutionContext): string {
    try {
      return guard.canActivate(context) ? 'PASS' : 'DENIED';
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(nowSeconds * 1000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('올바른 서명과 현재 시각의 콜백은 로그인 없이 통과한다', () => {
    expect(outcomeOf(contextOf({ headers: signedHeaders() }))).toBe('PASS');
  });

  it('본문 바이트가 1개 바뀌면 PG_CALLBACK_UNAUTHORIZED로 거절된다', () => {
    const tampered = body.replace('5000', '5001');

    expect(
      outcomeOf(contextOf({ headers: signedHeaders(), raw: tampered })),
    ).toBe('PG_CALLBACK_UNAUTHORIZED');
  });
});
