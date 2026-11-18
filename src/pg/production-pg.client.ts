import type {
  PgClient,
  PgClientConfigurationResult,
  PgPaymentCancelInquiry,
  PgPaymentCancelRequest,
} from './pg.client';
import type { PgCancelQueryResult, PgCancelSendResult } from './pg.types';

/** 실제 PG사 선정 후 통신을 구현할 운영용 클라이언트 골격이다. */
export class ProductionPgClient implements PgClient {
  validateConfiguration(): PgClientConfigurationResult {
    // PG사 선정 후 필요한 설정 이름과 누락 여부를 검사한다. 설정값은 결과에 포함하지 않는다.
    // 실제 PG 통신과 필수 설정 검증을 구현하기 전에는 준비 완료로 반환하지 않는다.
    return { ready: false, code: 'PG_IMPLEMENTATION_INCOMPLETE' };
  }

  requestPaymentCancel(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 실제 PG 연동 시 사용할 요청 입력이다.
    _request: PgPaymentCancelRequest,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 현재는 대기 중인 통신 작업이 없다.
    _signal: AbortSignal,
  ): Promise<PgCancelSendResult> {
    // PG사 규격에 맞춰 요청 ID·금액 매핑, 인증, 통신에 signal 전달을 구현한다.
    // 응답을 PgCancelSendResult로 변환하고 요청 전 실패 근거가 있을 때만 NOT_SENT를 반환한다.
    return Promise.reject(
      new Error('운영 PG의 결제 취소 요청이 구현되지 않았습니다'),
    );
  }

  inquirePaymentCancel(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 실제 PG 연동 시 사용할 요청 입력이다.
    _request: PgPaymentCancelInquiry,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 현재는 대기 중인 통신 작업이 없다.
    _signal: AbortSignal,
  ): Promise<PgCancelQueryResult> {
    // PG사 규격에 맞춰 요청 ID 매핑, 인증, 통신에 signal 전달을 구현한다.
    // 응답을 PgCancelQueryResult로 변환한다. PG가 미접수를 확정한 근거가 있을 때만
    // authoritative:true인 NOT_FOUND를 반환하며 일반 404·인증 오류·반영 지연과 구분한다.
    return Promise.reject(
      new Error('운영 PG의 결제 취소 조회가 구현되지 않았습니다'),
    );
  }
}
