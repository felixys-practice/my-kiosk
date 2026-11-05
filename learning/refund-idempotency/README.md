# 환불 멱등성 학습 예제

저장소 루트에서 실행한다. `.env`의 `DATABASE_URL`과 실행 중인 PostgreSQL이 필요하다.

```bash
node -r ts-node/register --test learning/refund-idempotency/refund-example.test.ts
```

`refund-example.ts`의 `RefundService.requestRefund`부터 읽는다.

```text
요청 기록 생성 또는 기존 기록 확인
  → 완료됐으면 저장된 응답 반환
  → 처리 중이면 기한 만료 후 담당 토큰 갱신 시도
  → refund_id가 없으면 confirmRefund
      → 담당 토큰 확인 및 행 락
      → 환불 생성 + 요청 기록에 refund_id 저장
      → 함께 커밋
  → sendCancellationAndComplete
      → PG 취소 호출
      → 최종 응답 저장
```

콜백으로 업무를 전달하지 않고, 환불 확정과 PG 취소를 명시적으로 호출하는 설계 예제다. 현재 서비스의 모든 계약을 대체하는 구현은 아니다.

## 실제로 검증하는 범위

- 같은 요청의 응답 재사용 및 다른 본문의 키 재사용 거절
- 환불 생성 후 복구 참조값 저장 실패 시 트랜잭션 전체 롤백
- PG 응답 유실 후 기존 환불을 유지한 복구
- 실제 행 락에 의한 담당 변경 대기 및 이전 담당 토큰 거절

DB 연결은 `src/test.ts`처럼 `PrismaClient`와 `PrismaPg`를 사용한다. 기존 업무 테이블과 분리하기 위해 테스트마다 `refund_learning_<UUID>` 스키마와 학습용 테이블을 생성한다. 학습용 테이블은 Prisma 모델로 생성하지 않았으므로 Prisma의 raw SQL 메서드로 접근한다. 사용자 입력은 SQL 파라미터로 전달한다. 테스트 종료 시 해당 스키마만 제거한다.

## 단순화한 범위

이 예제에는 요청자별 권한 검사, 키 형식 검사, 금액 계산, 이용 종료, 원장 반영이 없다. 키는 전역 고유하며 본문은 `ticketId` 하나다. 실제 프로세스를 종료하지 않고 DB 제약 오류와 PG 응답 유실로 실패를 재현한다.

PG는 가짜 구현이다. 같은 환불 ID의 취소 요청을 PG가 중복 제거한다고 가정한다. 실제 서비스에서 안전한 재전송을 하려면 PG의 멱등성 계약 또는 취소 결과 조회가 필요하다.

실제 코드와 비교할 위치는 `src/refund/refund-idempotency.service.ts`의 `execute`, `tryTakeOver`, `completeOrReplay`와 `src/refund/refund-idempotency.repository.ts`의 `acquireInTransaction`, `takeOver`다.
