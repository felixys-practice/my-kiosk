/**
 * 본문이 없거나 빈 객체({})만 허용하는 요청 (API 계약 §8 recovery/resume·pg-check)
 * - 검증 대상 필드가 없으므로 전역 ValidationPipe(forbidNonWhitelisted)가 어떤 필드든 400으로 거절한다
 */
export class EmptyBodyDto {}
