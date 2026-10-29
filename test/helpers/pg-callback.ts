import 'dotenv/config';
import request from 'supertest';
import { type App } from 'supertest/types';
import { createHash, createHmac } from 'crypto';

/** 서명 옵션 */
export type PgSignOptions = {
  timestamp?: number; // 서명 시각(Unix 초, 기본 현재)
  secret?: string; // 서명 비밀값(기본 .env의 PG_CALLBACK_SECRET)
};

/**
 * 환불 명세 API 계약 §7 규격으로 PG 콜백 서명을 만든다
 * - canonical = "v1\n{timestamp}\nPOST\n{path}\n{sha256(rawBody)}"
 * @param path 콜백 경로
 * @param raw 보낼 원문 본문
 * @param options 서명 시각·비밀값
 * @returns 서명 시각과 X-PG-Signature 값
 */
export function signPgCallback(
  path: string,
  raw: string,
  options: PgSignOptions = {},
): { timestamp: number; signature: string } {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const secret = options.secret ?? process.env.PG_CALLBACK_SECRET!;
  const bodyHash = createHash('sha256').update(raw, 'utf8').digest('hex');
  const canonical = `v1\n${timestamp}\nPOST\n${path}\n${bodyHash}`;
  const signature = `v1=${createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')}`;
  return { timestamp, signature };
}

/**
 * PG가 보내는 것처럼 서명한 콜백 요청을 만든다(로그인 없음)
 * @param server 테스트 앱 서버
 * @param path 콜백 경로(/payments/callback 또는 /refund/callback)
 * @param body 본문(JSON으로 직렬화한 원문 그대로 서명·전송)
 * @param options 서명 시각·비밀값
 * @returns supertest 요청
 */
export function signedCallback(
  server: App,
  path: '/payments/callback' | '/refund/callback',
  body: object,
  options: PgSignOptions = {},
) {
  const raw = JSON.stringify(body);
  const { timestamp, signature } = signPgCallback(path, raw, options);
  return request(server)
    .post(path)
    .set('Content-Type', 'application/json')
    .set('X-PG-Timestamp', String(timestamp))
    .set('X-PG-Signature', signature)
    .send(raw);
}
