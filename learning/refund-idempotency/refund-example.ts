// 실행: node -r ts-node/register --test learning/refund-idempotency/refund-example.test.ts
// 실제 PostgreSQL 트랜잭션을 사용하지만, 환불 업무와 PG는 학습용으로 단순화한다.
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

export type RefundCommand = { key: string; ticketId: string };
export type RefundResponse = { refundId: string; cancellation: string };
export type RequestRecord = {
  ticket_id: string;
  status: string;
  refund_id: string | null;
  response: RefundResponse;
};
export type RefundPg = { cancel(id: string): Promise<void> };

/** 환불 확정·PG 취소·응답 재사용을 조율하는 학습용 환불 전용 서비스. */
export class RefundService {
  constructor(
    private prisma: PrismaClient,
    private pg: RefundPg,
  ) {}

  /**
   * 새 요청이면 환불을 확정하고, 완료된 요청이면 저장된 응답을 반환한다.
   * 처리 기한이 지난 요청은 담당을 이어받은 뒤 refund_id로 복구 지점을 판단한다.
   * - refund_id 없음: 환불 확정 트랜잭션부터 실행한다.
   * - refund_id 있음: 환불 확정은 이미 커밋됐으므로 PG 취소부터 이어간다.
   * @param command 새 요청마다 생성하고 재시도 시 유지하는 키와 환불 대상 이용권
   * @returns 멱등성 기록에 저장한 최초 응답
   */
  async requestRefund(command: RefundCommand): Promise<RefundResponse> {
    // 키는 재시도 간 유지하지만, 담당 토큰은 실행마다 새로 만든다.
    const token = randomUUID();
    const [record] = await this.prisma.$queryRawUnsafe<RequestRecord[]>(
      `
      INSERT INTO requests (key, ticket_id, claim_token, claim_until)
      VALUES ($1, $2, $3::uuid, now() + interval '30 seconds')
      ON CONFLICT (key) DO NOTHING RETURNING *
    `,
      command.key,
      command.ticketId,
      token,
    );

    if (!record) {
      const [existing] = await this.prisma.$queryRawUnsafe<RequestRecord[]>(
        'SELECT * FROM requests WHERE key = $1',
        command.key,
      );
      // 본문은 ticketId 하나로 단순화했다. 인증·인가 역시 이 예제에서는 생략한다.
      if (existing.ticket_id !== command.ticketId) throw new Error('키 재사용');
      if (existing.status === 'COMPLETED') return existing.response;

      // 기존 트랜잭션이 행을 잠갔다면 이 UPDATE가 기다린다.
      const acquired = await this.takeOver(command.key, token);
      if (!acquired) throw new Error('처리 중');
    }

    // 담당 획득 뒤 최신 값을 읽는다. 이전 트랜잭션 커밋을 기다렸을 수 있다.
    const [current] = await this.prisma.$queryRawUnsafe<RequestRecord[]>(
      'SELECT * FROM requests WHERE key = $1',
      command.key,
    );
    let refundId = current.refund_id;
    if (!refundId) {
      try {
        refundId = await this.confirmRefund(command, token);
      } catch (error) {
        // 환불 확정 트랜잭션은 롤백됐다. 아직 내 담당인 처리 중 기록만 정리한다.
        await this.prisma.$executeRawUnsafe(
          `DELETE FROM requests
          WHERE key = $1 AND claim_token = $2::uuid AND status = 'IN_PROGRESS'`,
          command.key,
          token,
        );
        throw error;
      }
    }

    // 이후 실패에서는 이미 확정된 환불을 삭제하지 않는다.
    return this.sendCancellationAndComplete(command.key, token, refundId);
  }

  /**
   * 처리 중이고 기한이 지난 기록의 담당 토큰을 이번 실행의 토큰으로 바꾼다.
   * 기한 만료가 기존 실행의 중단을 뜻하지는 않는다. 기존 환불 확정 트랜잭션이
   * 행을 잠그고 있으면 UPDATE가 대기하고, 락 해제 후 조건을 다시 평가한다.
   * @returns 갱신한 행이 있으면 true, 기한·상태 조건이 맞지 않으면 false
   */
  async takeOver(key: string, token: string) {
    const result = await this.prisma.$queryRawUnsafe<{ key: string }[]>(
      `UPDATE requests
      SET claim_token = $2::uuid, claim_until = now() + interval '30 seconds'
      WHERE key = $1 AND status = 'IN_PROGRESS' AND claim_until <= now()
      RETURNING key`,
      key,
      token,
    );
    return result.length === 1;
  }

  /**
   * 담당 토큰을 확인하면서 요청 기록 행을 잠그고 환불을 확정한다.
   * 환불 생성과 requests.refund_id 저장은 함께 커밋되거나 함께 롤백된다.
   * 행 락은 트랜잭션 종료까지 유지되어 그동안 takeOver의 담당 변경을 막는다.
   * @returns 트랜잭션 커밋 후 확정된 환불 ID
   * @throws 담당을 잃었거나 DB 제약에 위배되면 예외를 던지고 전체 롤백한다.
   */
  async confirmRefund(command: RefundCommand, token: string): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.$queryRawUnsafe<{ key: string }[]>(
        `SELECT key FROM requests
        WHERE key = $1 AND claim_token = $2::uuid AND status = 'IN_PROGRESS'
        FOR UPDATE`,
        command.key,
        token,
      );
      if (!owned.length) throw new Error('담당을 잃음');

      const refundId = randomUUID();
      await tx.$executeRawUnsafe(
        'INSERT INTO refunds (id, ticket_id) VALUES ($1::uuid, $2)',
        refundId,
        command.ticketId,
      );
      await tx.$executeRawUnsafe(
        'UPDATE requests SET refund_id = $2::uuid WHERE key = $1',
        command.key,
        refundId,
      );
      return refundId;
    });
  }

  /**
   * 커밋된 환불 ID로 PG 취소를 호출한 뒤 멱등성 기록에 최종 응답을 저장한다.
   * PG 호출 또는 응답 저장이 실패해도 확정된 환불은 유지한다. 요청 기록이
   * IN_PROGRESS로 남으면 기한 만료 후 같은 환불 ID로 복구할 수 있다.
   * 담당을 잃었다면 자신의 응답으로 덮어쓰지 않고, 이미 저장된 응답을 반환하거나
   * 아직 처리 중임을 알린다. PG 취소 성공과 DB 응답 저장은 원자적이지 않다.
   */
  async sendCancellationAndComplete(
    key: string,
    token: string,
    refundId: string,
  ): Promise<RefundResponse> {
    // PG 호출은 DB 트랜잭션 밖에서 한다. 같은 취소 ID의 재호출은 PG가 중복 제거한다고 가정한다.
    await this.pg.cancel(refundId);
    const response = { refundId, cancellation: 'SUCCEEDED' };
    const completed = await this.prisma.$queryRawUnsafe<{ key: string }[]>(
      `UPDATE requests
      SET status = 'COMPLETED', response = $3::jsonb, claim_token = NULL
      WHERE key = $1 AND claim_token = $2::uuid AND status = 'IN_PROGRESS'
      RETURNING key`,
      key,
      token,
      JSON.stringify(response),
    );
    if (completed.length) return response;
    const [stored] = await this.prisma.$queryRawUnsafe<RequestRecord[]>(
      'SELECT * FROM requests WHERE key = $1',
      key,
    );
    if (stored.status === 'COMPLETED') return stored.response;
    throw new Error('처리 중');
  }
}
