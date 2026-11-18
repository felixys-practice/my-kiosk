# TDD 실행 기록

## 2026-11-15 최초 모의 취소 성공

- 범위: T021·T022 중 최초 요청의 성공 결과 반환. 결과 저장·조회는 다음 동작으로 남긴다.
- 준비: 인터페이스를 만족하는 클래스 골격을 만들고 요청은 UNKNOWN, 조회는 QUERY_ERROR를 반환하게 했다. 앱에는 연결하지 않았다.
- 실패 확인 명령: `npx vitest run src/pg/simulated-pg.client.spec.ts`
- 실제 실패 출력(발췌):

```text
AssertionError: expected { result: 'UNKNOWN', …(1) } to deeply equal { result: 'SUCCEEDED', …(2) }
- "cancelledAmount": 12000,
- "pgTransactionId": StringMatching /^simulated-.+/,
- "result": "SUCCEEDED",
+ "reason": "모의 취소 미구현",
+ "result": "UNKNOWN",
Test Files 1 failed (1)
Tests 1 failed (1)
```

- 실패 이유: 요구한 취소 성공·요청액·모의 거래 ID 대신 미구현 결과를 반환했다. import·타입 오류가 아니다.
- 최소 구현: randomUUID로 모의 거래 ID를 만들고 요청액을 cancelledAmount로 반환했다.
- 같은 명령으로 재검증: 테스트 1개 통과, 종료 코드 0.
- 타입 검사: `npx tsc --noEmit --incremental false` 통과, 종료 코드 0.
- 이번 동작은 별도 리팩터링이 필요하지 않았다. 의도적 변형 검증은 T045에서 수행한다.

## 2026-11-15 취소 결과 저장·조회

- 범위: T021·T022의 남은 결과 Map 저장·조회. 서로 다른 두 요청 ID의 금액·거래 ID가 각 요청의 결과와 같은지 검증한다.
- 실패 확인 명령: `npx vitest run src/pg/simulated-pg.client.spec.ts`
- 실제 실패 출력(발췌):

```text
AssertionError: expected { result: 'QUERY_ERROR', …(1) } to deeply equal { result: 'SUCCEEDED', …(2) }
- "cancelledAmount": 12000,
- "pgTransactionId": "simulated-a38a9266-1859-4836-831b-3c5322c5f1ce",
- "result": "SUCCEEDED",
+ "reason": "모의 조회 미구현",
+ "result": "QUERY_ERROR",
Tests 1 failed | 1 passed (2)
```

- 실패 이유: 저장된 취소 결과 대신 미구현 조회 오류를 반환했다.
- 구현: 인스턴스 Map에 요청 ID별 성공 결과를 저장하고 해당 ID의 결과를 조회한다. 반환 객체는 복사한다.
- 재검증: 같은 명령에서 2개 통과, 종료 코드 0. `npx tsc --noEmit --incremental false`도 통과했다.
- import를 파일 상단으로 정리했다. 중복 요청·기록 유실·금액 경계 검증은 후속 태스크에 남긴다.

## 2026-11-15 같은 요청 ID·금액의 최초 결과 재사용

- 범위: T023·T024 중 같은 ID·같은 금액의 재요청. 다른 금액 처리는 아직 구현하지 않는다.
- 실패 확인 명령: `npx vitest run src/pg/simulated-pg.client.spec.ts`
- 실제 실패 출력(발췌):

```text
AssertionError: expected { result: 'SUCCEEDED', …(2) } to deeply equal { result: 'SUCCEEDED', …(2) }
- "pgTransactionId": "simulated-5a46df52-b7bc-4cc7-8a56-68c3f283b703",
+ "pgTransactionId": "simulated-4417fe5d-f54b-499f-acab-2a507f31ef22",
Tests 1 failed | 2 passed (3)
```

- 실패 이유: 재요청 시 새 거래 ID를 만들어 최초 결과와 달랐다.
- 구현: ID로 찾은 기존 결과의 금액이 요청액과 같으면 최초 결과의 복사본을 반환한다. 거래 ID 생성과 Map 저장은 건너뛴다.
- 재검증: 같은 명령에서 테스트 3개 통과. `npx tsc --noEmit --incremental false` 통과. 모두 종료 코드 0.
- 별도 리팩터링은 필요하지 않았다. T023·T024는 다른 금액 재요청 검증·구현이 남아 미완료로 유지한다.

## 2026-11-15 모의 클라이언트 단위 동작 완료

### 다른 금액 재요청

- 명령: `npx vitest run src/pg/simulated-pg.client.spec.ts`
- 실제 실패 출력:

```text

 RUN  v5.1.0 /Users/felix/Develop/practice/my-kiosk

 ❯ src/pg/simulated-pg.client.spec.ts (4 tests | 1 failed) 5ms
   ❯ SimulatedPgClient (4)
     × 같은 ID로 다른 금액을 요청하면 UNKNOWN을 반환하고 최초 조회 결과를 유지한다 4ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/pg/simulated-pg.client.spec.ts > SimulatedPgClient > 같은 ID로 다른 금액을 요청하면 UNKNOWN을 반환하고 최초 조회 결과를 유지한다
AssertionError: expected { result: 'SUCCEEDED', …(2) } to deeply equal { result: 'UNKNOWN', …(1) }

- Expected
+ Received

  {
-   "reason": Any<String>,
-   "result": "UNKNOWN",
+   "cancelledAmount": 7000,
+   "pgTransactionId": "simulated-c1623c65-7945-4430-b3c1-be7f7b2883d6",
+   "result": "SUCCEEDED",
  }

 ❯ src/pg/simulated-pg.client.spec.ts:12:8
     10|     expect(await client.requestPaymentCancel(
     11|       { paymentCancelId: 'cancel-conflict', amount: 7000 }, signal,
     12|     )).toEqual({ result: 'UNKNOWN', reason: expect.any(String) });
       |        ^
     13|     expect(await client.inquirePaymentCancel(
     14|       { paymentCancelId: 'cancel-conflict' }, signal,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
   Start at  10:02:57
   Duration  96ms (transform 50%, tests 18%, worker 13%, import 10%, setup 9%)


```

- 원인: 같은 요청 ID의 다른 금액에도 새 성공 결과를 만들었다.
- 수정: 최초 기록이 있으면서 금액이 다르면 UNKNOWN을 반환하고 기록을 유지한다.
- 같은 명령으로 4개 통과.

### 기록 부재·인스턴스 수명

- 기존 구현에 추가 검증을 작성하여 7개 통과했다. 이미 구현된 동작으로 실패 확인은 없었다.
- 새 인스턴스와 다른 인스턴스는 Map을 공유하지 않는다. 프로세스 재시작·업무 DB 복구 E2E는 아직 실행하지 않았다.

### 유효하지 않은 금액 거부

- 명령: `npx vitest run src/pg/simulated-pg.client.spec.ts`
- 음수·소수·NaN·Infinity·안전 정수 초과는 하나의 금액 검증 동작에 대한 입력 사례다.
- 실제 실패 출력:

```text

 RUN  v5.1.0 /Users/felix/Develop/practice/my-kiosk

 ❯ src/pg/simulated-pg.client.spec.ts (12 tests | 5 failed) 9ms
   ❯ SimulatedPgClient (12)
     × 유효하지 않은 금액 -1는 요청 전에 거부하고 결과를 저장하지 않는다 4ms
     × 유효하지 않은 금액 0.5는 요청 전에 거부하고 결과를 저장하지 않는다 1ms
     × 유효하지 않은 금액 NaN는 요청 전에 거부하고 결과를 저장하지 않는다 1ms
     × 유효하지 않은 금액 Infinity는 요청 전에 거부하고 결과를 저장하지 않는다 0ms
     × 유효하지 않은 금액 9007199254740992는 요청 전에 거부하고 결과를 저장하지 않는다 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/pg/simulated-pg.client.spec.ts > SimulatedPgClient > 유효하지 않은 금액 -1는 요청 전에 거부하고 결과를 저장하지 않는다
AssertionError: expected { result: 'SUCCEEDED', …(2) } to deeply equal { result: 'NOT_SENT', …(1) }

- Expected
+ Received

  {
-   "reason": Any<String>,
-   "result": "NOT_SENT",
+   "cancelledAmount": -1,
+   "pgTransactionId": "simulated-171fcb99-82c1-4532-a8e9-f7286b2c6ab4",
+   "result": "SUCCEEDED",
  }

 ❯ src/pg/simulated-pg.client.spec.ts:10:10
      8|       expect(await client.requestPaymentCancel(
      9|         { paymentCancelId: 'cancel-invalid', amount }, signal,
     10|       )).toEqual({ result: 'NOT_SENT', reason: expect.any(String) });
       |          ^
     11|       expect(await client.inquirePaymentCancel(
     12|         { paymentCancelId: 'cancel-invalid' }, signal,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/5]⎯

 FAIL  src/pg/simulated-pg.client.spec.ts > SimulatedPgClient > 유효하지 않은 금액 0.5는 요청 전에 거부하고 결과를 저장하지 않는다
AssertionError: expected { result: 'SUCCEEDED', …(2) } to deeply equal { result: 'NOT_SENT', …(1) }

- Expected
+ Received

  {
-   "reason": Any<String>,
-   "result": "NOT_SENT",
+   "cancelledAmount": 0.5,
+   "pgTransactionId": "simulated-0470e24f-be71-41fb-842f-22e7a2602e05",
+   "result": "SUCCEEDED",
  }

 ❯ src/pg/simulated-pg.client.spec.ts:10:10
      8|       expect(await client.requestPaymentCancel(
      9|         { paymentCancelId: 'cancel-invalid', amount }, signal,
     10|       )).toEqual({ result: 'NOT_SENT', reason: expect.any(String) });
       |          ^
     11|       expect(await client.inquirePaymentCancel(
     12|         { paymentCancelId: 'cancel-invalid' }, signal,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/5]⎯

 FAIL  src/pg/simulated-pg.client.spec.ts > SimulatedPgClient > 유효하지 않은 금액 NaN는 요청 전에 거부하고 결과를 저장하지 않는다
AssertionError: expected { result: 'SUCCEEDED', …(2) } to deeply equal { result: 'NOT_SENT', …(1) }

- Expected
+ Received

  {
-   "reason": Any<String>,
-   "result": "NOT_SENT",
+   "cancelledAmount": NaN,
+   "pgTransactionId": "simulated-2411b714-0304-4d78-8145-58deaa6f4e36",
+   "result": "SUCCEEDED",
  }

 ❯ src/pg/simulated-pg.client.spec.ts:10:10
      8|       expect(await client.requestPaymentCancel(
      9|         { paymentCancelId: 'cancel-invalid', amount }, signal,
     10|       )).toEqual({ result: 'NOT_SENT', reason: expect.any(String) });
       |          ^
     11|       expect(await client.inquirePaymentCancel(
     12|         { paymentCancelId: 'cancel-invalid' }, signal,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/5]⎯

 FAIL  src/pg/simulated-pg.client.spec.ts > SimulatedPgClient > 유효하지 않은 금액 Infinity는 요청 전에 거부하고 결과를 저장하지 않는다
AssertionError: expected { result: 'SUCCEEDED', …(2) } to deeply equal { result: 'NOT_SENT', …(1) }

- Expected
+ Received

  {
-   "reason": Any<String>,
-   "result": "NOT_SENT",
+   "cancelledAmount": Infinity,
+   "pgTransactionId": "simulated-1e46cd3b-5f11-45e2-a74a-d2cfd835f597",
+   "result": "SUCCEEDED",
  }

 ❯ src/pg/simulated-pg.client.spec.ts:10:10
      8|       expect(await client.requestPaymentCancel(
      9|         { paymentCancelId: 'cancel-invalid', amount }, signal,
     10|       )).toEqual({ result: 'NOT_SENT', reason: expect.any(String) });
       |          ^
     11|       expect(await client.inquirePaymentCancel(
     12|         { paymentCancelId: 'cancel-invalid' }, signal,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/5]⎯

 FAIL  src/pg/simulated-pg.client.spec.ts > SimulatedPgClient > 유효하지 않은 금액 9007199254740992는 요청 전에 거부하고 결과를 저장하지 않는다
AssertionError: expected { result: 'SUCCEEDED', …(2) } to deeply equal { result: 'NOT_SENT', …(1) }

- Expected
+ Received

  {
-   "reason": Any<String>,
-   "result": "NOT_SENT",
+   "cancelledAmount": 9007199254740992,
+   "pgTransactionId": "simulated-bc2907f2-ca02-454f-87ab-e53a1d57259f",
+   "result": "SUCCEEDED",
  }

 ❯ src/pg/simulated-pg.client.spec.ts:10:10
      8|       expect(await client.requestPaymentCancel(
      9|         { paymentCancelId: 'cancel-invalid', amount }, signal,
     10|       )).toEqual({ result: 'NOT_SENT', reason: expect.any(String) });
       |          ^
     11|       expect(await client.inquirePaymentCancel(
     12|         { paymentCancelId: 'cancel-invalid' }, signal,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯


 Test Files  1 failed (1)
      Tests  5 failed | 7 passed (12)
   Start at  10:03:26
   Duration  130ms (transform 45%, tests 22%, import 15%, worker 11%, setup 7%)


```

- 원인: 유효하지 않은 금액도 SUCCEEDED로 반환했다.
- 수정: 0 이상 안전 정수가 아니면 저장 전에 NOT_SENT를 반환한다.
- 같은 명령으로 12개 통과. 0·최대 안전 정수의 허용 경계 테스트 추가 후 모의 클라이언트 14개 통과.
- 최종 검증: `npx vitest run src/pg/simulated-pg.client.spec.ts src/pg/pg.service.spec.ts` 2개 파일·37개 테스트 통과. `npx tsc --noEmit --incremental false` 통과.
- 금액 허용 경계는 기존 성공 구현으로 바로 통과했으며 새 실패 증거로 주장하지 않는다.

## 2026-11-15 운영 구현 준비 상태 거부

- 명령: `npx vitest run src/pg/production-pg.client.spec.ts`
- 실제 실패 출력:

```text

 RUN  v5.1.0 /Users/felix/Develop/practice/my-kiosk

 ❯ src/pg/production-pg.client.spec.ts (1 test | 1 failed) 4ms
   ❯ ProductionPgClient (1)
     × 실제 PG 통신 미구현을 준비 상태 검사에 반환한다 4ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/pg/production-pg.client.spec.ts > ProductionPgClient > 실제 PG 통신 미구현을 준비 상태 검사에 반환한다
AssertionError: expected { ready: true } to deeply equal { ready: false, …(1) }

- Expected
+ Received

  {
-   "code": "PG_IMPLEMENTATION_INCOMPLETE",
-   "ready": false,
+   "ready": true,
  }

 ❯ src/pg/production-pg.client.spec.ts:5:62
      3| describe('ProductionPgClient', () => {
      4|   it('실제 PG 통신 미구현을 준비 상태 검사에 반환한다', () => {
      5|     expect(new ProductionPgClient().validateConfiguration()).toEqual({
       |                                                              ^
      6|       ready: false,
      7|       code: 'PG_IMPLEMENTATION_INCOMPLETE',

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  10:11:48
   Duration  105ms (transform 56%, tests 15%, worker 13%, setup 11%, import 5%)


```

- 구현 후 같은 파일의 테스트 1개 통과. 각 동작의 실패 확인 후 해당 구현만 변경했다.

## 2026-11-15 취소 요청 미구현 오류

- 명령: `npx vitest run src/pg/production-pg.client.spec.ts`
- 실제 실패 출력:

```text

 RUN  v5.1.0 /Users/felix/Develop/practice/my-kiosk

 ❯ src/pg/production-pg.client.spec.ts (2 tests | 1 failed) 6ms
   ❯ ProductionPgClient (2)
     × 취소 요청은 성공 결과 대신 실제 PG 미구현 오류로 거부한다 5ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/pg/production-pg.client.spec.ts > ProductionPgClient > 취소 요청은 성공 결과 대신 실제 PG 미구현 오류로 거부한다
AssertionError: promise resolved "{ result: 'UNKNOWN', …(1) }" instead of rejecting

- Expected
+ Received

- Error {
-   "message": "rejected promise",
+ {
+   "reason": "운영 PG 미구현",
+   "result": "UNKNOWN",
  }

 ❯ src/pg/production-pg.client.spec.ts:7:35
      5|     await expect(new ProductionPgClient().requestPaymentCancel(
      6|       { paymentCancelId: 'cancel-production', amount: 12000 },
      7|       new AbortController().signal,
       |                                   ^
      8|     )).rejects.toThrow('운영 PG의 결제 취소 요청이 구현되지 않았습니다');
      9|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Start at  10:12:01
   Duration  100ms (transform 46%, tests 22%, worker 13%, setup 12%, import 7%)


```

- 구현 후 같은 파일의 테스트 2개 통과. 각 동작의 실패 확인 후 해당 구현만 변경했다.

## 2026-11-15 취소 조회 미구현 오류

- 명령: `npx vitest run src/pg/production-pg.client.spec.ts`
- 실제 실패 출력:

```text

 RUN  v5.1.0 /Users/felix/Develop/practice/my-kiosk

 ❯ src/pg/production-pg.client.spec.ts (3 tests | 1 failed) 5ms
   ❯ ProductionPgClient (3)
     × 취소 조회는 조회 결과 대신 실제 PG 미구현 오류로 거부한다 4ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/pg/production-pg.client.spec.ts > ProductionPgClient > 취소 조회는 조회 결과 대신 실제 PG 미구현 오류로 거부한다
AssertionError: promise resolved "{ result: 'QUERY_ERROR', …(1) }" instead of rejecting

- Expected
+ Received

- Error {
-   "message": "rejected promise",
+ {
+   "reason": "운영 PG 미구현",
+   "result": "QUERY_ERROR",
  }

 ❯ src/pg/production-pg.client.spec.ts:7:35
      5|     await expect(new ProductionPgClient().inquirePaymentCancel(
      6|       { paymentCancelId: 'cancel-production' },
      7|       new AbortController().signal,
       |                                   ^
      8|     )).rejects.toThrow('운영 PG의 결제 취소 조회가 구현되지 않았습니다');
      9|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
   Start at  10:12:16
   Duration  88ms (transform 45%, tests 22%, worker 14%, setup 11%, import 7%)


```

- 구현 후 같은 파일의 테스트 3개 통과. 각 동작의 실패 확인 후 해당 구현만 변경했다.

- 최종 PG 회귀: 운영 골격·모의 클라이언트·기존 PgService 3개 파일의 테스트 40개 통과. 타입 검사 통과. 별도 리팩터링은 필요하지 않았다.

## 2026-11-15 Phase 3: 새 동작의 실패 확인

기존 계약 전달·타임아웃·예외는 구조 변경으로 기존 검증 의미를 유지했다. 새 성공 정보 검증과 시작·로그 동작은 아래 순서로 각각 실패를 확인하고 대응 구현 후 재검증했다.

### 취소 성공 거래 ID

- 명령: `npx vitest run src/pg/pg.service.spec.ts`
- 실제 실패 출력(발췌):

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected { result: 'SUCCEEDED', …(2) } to match object { result: 'UNKNOWN' }
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
```

### 조회 성공 거래 ID

- 명령: `npx vitest run src/pg/pg.service.spec.ts`
- 실제 실패 출력(발췌):

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected { result: 'SUCCEEDED', …(2) } to match object { result: 'QUERY_ERROR' }
 Test Files  1 failed (1)
      Tests  1 failed | 23 passed (24)
```

### 취소 성공 실제액

- 명령: `npx vitest run src/pg/pg.service.spec.ts`
- 실제 실패 출력(발췌):

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected { result: 'SUCCEEDED', …(2) } to match object { result: 'UNKNOWN' }
 Test Files  1 failed (1)
      Tests  1 failed | 24 passed (25)
```

### 조회 성공 실제액

- 명령: `npx vitest run src/pg/pg.service.spec.ts`
- 실제 실패 출력(발췌):

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected { result: 'SUCCEEDED', …(2) } to match object { result: 'QUERY_ERROR' }
 Test Files  1 failed (1)
      Tests  1 failed | 25 passed (26)
```

### 모드 누락 시작 거부

- 명령: `npx vitest run --config vitest.config.e2e.mts test/pg-client-startup.e2e-spec.ts`
- 실제 실패 출력(발췌):

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: promise resolved "NestApplication{ …(23) }" instead of rejecting
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

### 운영 모의 시작 거부

- 명령: `npx vitest run --config vitest.config.e2e.mts test/pg-client-startup.e2e-spec.ts`
- 실제 실패 출력(발췌):

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: promise resolved "NestApplication{ …(23) }" instead of rejecting
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

### 운영 골격 시작 거부

- 명령: `npx vitest run --config vitest.config.e2e.mts test/pg-client-startup.e2e-spec.ts`
- 실제 실패 출력(발췌):

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: promise resolved "NestApplication{ …(23) }" instead of rejecting
AssertionError: promise resolved "NestApplication{ …(23) }" instead of rejecting
 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

### 필수 설정 누락 안내

- 명령: `npx vitest run --config vitest.config.e2e.mts test/pg-client-startup.e2e-spec.ts`
- 실제 실패 출력(발췌):

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected [Function] to throw error including 'PG_VENDOR_KEY' but got 'PG_CONFIGURATION_MISSING'
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
```

### 성공 모드·구현 로그

- 명령: `npx vitest run --config vitest.config.e2e.mts test/pg-client-startup.e2e-spec.ts`
- 실제 실패 출력(발췌):

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected '[["RootTestModule dependencies initia…' to contain 'simulated'
 Test Files  1 failed (1)
      Tests  2 failed | 4 passed (6)
```

### 설정 오류 로그 비밀값 보호

- 명령: `npx vitest run --config vitest.config.e2e.mts test/pg-client-startup.e2e-spec.ts`
- 실제 실패 출력(발췌):

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: expected '[]' to contain 'CONFIGURATION_INVALID'
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

- 모드 누락 테스트의 첫 시도는 로거 주입 오류였다. 테스트 로거를 대체하여 정상 초기화가 가능한 상태에서 다시 실행했고, 앱이 시작되어 거부 기대와 불일치하는 실패를 증거로 사용했다.
- 운영 모의 선택의 Joi 조건을 보완하던 중 해당 사례가 계속 실패하여 객체 단위 환경 조합 검사로 수정한 뒤 통과했다. 운영 골격 첫 실패 확인 시에는 앞선 환경 조합 사례도 실패했으므로, 단일 테스트만 실패했다고 주장하지 않는다.
- 각 대응 구현 후 같은 파일을 재검증했다. 금액·ID의 추가 경계 및 미지원 모드·구조화 설정은 이미 구현된 규칙의 보완 검증으로 바로 통과했으며 새로운 red 증거로 주장하지 않는다.
- 시작 검증은 업무 DB 없이 실제 Nest 앱에서 동일 설정 검증 함수와 PgModule을 초기화한다. 전체 AppModule 연결은 전체 E2E에서 별도로 확인한다.

## 2026-11-15 Phase 4: 앱 통합 검증

- 이번 Phase는 Phase 3까지 구현한 동작과 기존 환불 계약의 앱 통합·회귀 검증이다. 제품 코드는 변경하지 않았다. 기존 동작을 검증하는 새 E2E가 바로 통과한 것을 새 제품 동작의 red 증거로 주장하지 않는다.
- 최초 명령: `npx vitest run --config vitest.config.e2e.mts test/pg-client.e2e-spec.ts` — 실제 모의 취소·조회·중복 결과 사례 1개 통과.
- 앱 재생성 사례를 추가한 같은 파일 실행에서는 본문 검증 후 helper의 중복 앱 종료가 실패했다. 실제 출력 발췌:

```text
FAIL test/pg-client.e2e-spec.ts > 실제 모의 PG를 연결한 환불 (E2E) > 앱을 종료하고 재생성해도 환불 조회는 유지되고 모의 처리 기록은 사라진다 (QS-8)
Error: Connection is closed.
Object.close test/helpers/refund-test-context.ts:384:5
Tests 1 failed | 1 passed (2)
```

- helper에 stopApplication을 추가해 데이터를 보존한 앱 종료와 마지막 데이터 정리를 구분했다. 이미 종료한 앱은 다시 종료하지 않는다. 같은 파일 재검증에서 2개 통과했다.
- 이후 기록 유실·재전송 금지, 조회 성공 후 중복 콜백, 좌석 배정 실패 시스템 환불의 PG 호출 ID·금액·커밋 상태 검증을 추가했다. 이들은 이미 구현한 계약의 보완 검증이며 제품 코드를 일부러 바꾸어 실패를 만들지 않았다. 의도적 변형 검증은 Phase 5의 T045에 남긴다.

- Phase 4 최종 전체 E2E: 18개 파일·212개 통과, 실패 파일·사례 0, 종료 코드 0. 타입 검사도 통과했다.


## 2026-11-18 FAILED/RETRY_EXHAUSTED 개별 조회 성공 반영

- 사용자 승인 범위: 기존 요청에 성공 결과 반영, 새 요청·추가 전송 없음, 내부 실패 경위 로그 보존. IN_PROGRESS 복귀·일반 재시도 메서드 정리·MANUAL → PG 전환은 제외한다.
- 테스트 선행: RC-03 RETRY_EXHAUSTED 사례를 추가했다. 기존 성공 충돌 테스트는 확정된 계약에 맞춰 PG_REJECTED를 대상으로 변경했고, RETRY_EXHAUSTED의 IN_PROGRESS 충돌 기대는 다음 단계까지 유지한다.
- 실패 확인 명령: `node node_modules/vitest/vitest.mjs run src/refund/refund-result.integration.spec.ts -t 'RC-03 RETRY_EXHAUSTED'`
- 최초 샌드박스 실행은 DB 준비·정리 단계 실패로 본문이 실행되지 않았다. 제품 동작의 실패 증거로 사용하지 않는다.
- 권한 확장 재실행: 1개 실패·107개 미선택. 기대한 PAID·SUCCEEDED 대신 ACTION_REQUIRED·FAILED 및 reviewRequired=true가 저장되어 의도한 실패를 확인했다. 전체 출력: `/private/tmp/refund-retry-exhausted-red.log`.

```text
-       "status": "SUCCEEDED",
+       "status": "FAILED",
-   "payoutStatus": "PAID",
-   "reviewRequired": false,
+   "payoutStatus": "ACTION_REQUIRED",
+   "reviewRequired": true,
Tests  1 failed | 107 skipped (108)
```

- 구현: RefundResultService.applyPgResult()의 개별 조회 성공 정정 조건에 RETRY_EXHAUSTED를 추가한다. 작업 토큰·현재 상태·지급 조건 재검사와 PG_REJECTED 충돌 처리는 유지한다. 이전 내부 실패 사유에 맞춰 거래 로그 상태를 기록한다.

- 구현 후 직접 실행: `node node_modules/vitest/vitest.mjs run src/refund/refund-result.integration.spec.ts -t 'RC-03|PG 거절로 실패한 요청의 재조회가 취소 성공'` — 3개 통과·105개 미선택, 종료 0. RETRY_EXHAUSTED 성공·SEND_FAILED 성공·PG_REJECTED 성공 충돌을 검증했다. 출력: `/private/tmp/refund-retry-exhausted-green.log`.
- `npx tsc --noEmit`, 변경한 두 TypeScript 파일의 Prettier 검사, `git diff --check` 통과. ESLint는 기존 RC-03 SEND_FAILED 사례의 `paidAt: expect.any(Date)`에서 no-unsafe-assignment 1건이 남았다. 이번 추가 구간의 같은 오류는 해결했으며 기존 사례는 수정하지 않았다.
- 전체 회귀·IN_PROGRESS 복귀·외부 실제 PG는 이번 단계에서 검증하지 않았다. 사용자 제공 결과를 새 실행 결과로 사용하지 않았다. 커밋하지 않았다.


## 2026-11-18 FAILED 내부 실패의 IN_PROGRESS 복귀

- 사용자 승인: FAILED/SEND_FAILED·FAILED/RETRY_EXHAUSTED의 처리 중 조회는 기존 PaymentCancel.status=REQUESTED·Refund.payoutStatus=PENDING으로 복귀하고 조회를 재개한다. PG_REJECTED 충돌 처리는 유지한다.
- 테스트 선행: RC-04를 두 내부 실패 사유로 실행했다. 지급액·원장·새 요청·전송 없음, 실패 필드 해제, 재전송 횟수 보존, 다음 조회 예약, 이전 실패 로그를 검증한다. 기존 처리 중 충돌 기대는 확정된 계약에 맞춰 PG_REJECTED 대상으로 바꿨다.
- 실패 확인 명령: `node node_modules/vitest/vitest.mjs run src/refund/refund-result.integration.spec.ts -t RC-04`
- 직접 실행 결과: 2개 실패·108개 미선택. 기대한 PENDING·검토 불필요 대신 ACTION_REQUIRED·PG_RESULT_CONFLICT·reviewRequired=true가 저장되어 의도한 실패를 확인했다. 전체 출력: `/private/tmp/refund-in-progress-red.log`.

```text
-   "actionCode": null,
+   "actionCode": "PG_RESULT_CONFLICT",
-   "payoutStatus": "PENDING",
-   "reviewRequired": false,
+   "payoutStatus": "ACTION_REQUIRED",
+   "reviewRequired": true,
Tests  2 failed | 108 skipped (110)
```

- 구현: RefundRetryService.checkFailedAttempt()는 잠금·담당 토큰 확인 후 최신 실패 요청·지급액·다른 지급·예약·PG 지급 방식을 재검사한다. RefundRepository.resumePgCancelStatusInquiry()와 같은 트랜잭션에서 상태·실패 필드·조회 일정을 저장하고 Refund 조치 사유를 해제한다. 이전 실패 경위는 커밋 후 거래 로그에 남긴다. 외부 조회는 트랜잭션 밖에서 수행하며 새 요청·전송·횟수 증가는 없다.

- 구현 후 직접 실행: `node node_modules/vitest/vitest.mjs run src/refund/refund-result.integration.spec.ts` — 110개 통과·실패 0, 종료 0. RC-04 두 사례·PG_REJECTED 처리 중 충돌·앞 단계 성공 반영을 포함한 파일 전체를 검증했다. 출력: `/private/tmp/refund-in-progress-green.log`.
- `npx tsc --noEmit`, 변경한 세 TypeScript 파일의 Prettier 검사, `git diff --check` 통과. ESLint는 기존 SEND_FAILED 테스트의 2540행 no-unsafe-assignment 1건만 남았다. 이번 수정 구간의 새 오류는 없다.
- 전체 프로젝트 회귀·외부 실제 PG는 미실행. 사용자 제공 결과를 직접 실행 결과로 사용하지 않았으며 커밋하지 않았다.


## 2026-11-18 일반 PG 재시도 API 제거 및 pg-check 호출 통일

- 사용자 승인: RefundRetryService.retryByManager()와 직접 호출 테스트 정리. 호출처 확인 결과 RefundOperationsController의 payout-retries 라우트가 남아 있음을 먼저 보고하고 일반 PG 재시도 경로 제거 범위로 처리했다. MANUAL → PG 전환은 확정하지 않는다.
- 테스트 선행: RC-05는 인증된 운영자의 폐지 API 호출에서 404와 PG 미호출·요청 수 불변을 검증한다.
- 실패 확인 명령: `node node_modules/vitest/vitest.mjs run --config vitest.config.e2e.mts test/refund-operations.e2e-spec.ts -t RC-05`
- 직접 실행 실패: 1개 실패·19개 미선택. 실제 출력: `Error: expected 404 "Not Found", got 202 "Accepted"`. 로그: `/private/tmp/refund-remove-retry-red.log`.
- 구현: payout-retries 라우트·retryByManager()·전용 명령/응답 타입·RetryRefundDto와 전용 검증 테스트·retrySchema를 제거했다. 현재 API 작업 타입에서 PAYOUT_RETRY를 제거했고 과거 DB 기록·컬럼은 보존했다.
- 통합 테스트 3건을 pg-check의 선행 조회 경로로 전환해 이용 종료 유지·결제 전체 대상·횟수 보존을 계속 확인한다. 기존 E2E는 점주/운영자 허용·키/사유 생략·반복/동시 실행·지급 완료/예약/일부 지급 차단·예약 후 앱 재생성·새 요청/예약 경쟁을 pg-check 계약으로 검증한다. 폐지 계약의 전용 사유 DTO 검증 3건은 DTO와 함께 제거했다.
- 인접 E2E의 SEND_FAILED 처리 중 조회 기대도 앞 단계에서 확정·구현한 조회 재개 동작에 맞췄다. 별도 지급 API의 오류 계약은 유지한다.
- 수정한 E2E 직접 실행: `node node_modules/vitest/vitest.mjs run --config vitest.config.e2e.mts test/refund-operations.e2e-spec.ts test/refund-concurrency.e2e-spec.ts test/refund-crash-recovery.e2e-spec.ts` — 3파일·41개 통과, 종료 0. 로그: `/private/tmp/refund-remove-retry-e2e.log`.

- 최초 전체 단위·통합 검증: 665개 통과·1개 실패. Refund Swagger 테스트가 기존 엔드포인트 17개를 기대해 실제 16개와 달랐다. 승인된 라우트 제거에 맞춰 기대 개수를 갱신하고 payout-retries 경로 부재·pg-check 경로 존재 검증을 추가했다. 다른 성공 스키마·인증 검증은 유지했다. 해당 Swagger 파일 3개 재검증 통과.
- 최종 전체 단위·통합 직접 실행: `npm run test` — 56파일·666개 통과, 실패 0. 로그: `/private/tmp/refund-remove-retry-unit-all.log`.
- `npx tsc --noEmit`, 수정 TypeScript 파일 Prettier 검사와 `git diff --check` 통과. ESLint는 기존 SEND_FAILED 통합 테스트의 no-unsafe-assignment 1건과 기존 ApiRefundResponse·ApiRefundErrors 명명 경고 2건이 남았다. 이번 변경 구간의 신규 오류는 없다.

- 최종 전체 E2E 직접 실행: `npm run test:e2e` — 18파일·213개 통과, 실패 0, 종료 0. 로그: `/private/tmp/refund-remove-retry-e2e-all.log`.
- 실제 외부 PG는 미검증이며 모든 결과는 이번 턴에 직접 실행한 테스트 결과다. MANUAL → PG 전환·클라이언트는 변경하지 않았다. 커밋하지 않았다.


## 2026-11-18 린트·빌드 마무리 — 동작 변경 없음

- 사용자 승인에 따라 SEND_FAILED 성공 테스트의 날짜 단언을 별도 toBeInstanceOf(Date) 검증으로 옮기고, Swagger 함수명을 apiRefundResponse·apiRefundErrors로 바꿔 import·호출처를 맞췄다. 검증 의미와 HTTP 계약을 유지하며 린트 규칙을 끄지 않았다. 새 동작의 red 증거로 주장하지 않는다.
- 직접 실행: 변경·신규 TypeScript 62개 파일 ESLint 오류·경고 0, npx tsc --noEmit 및 npm run build 통과. Swagger 테스트 3개와 RC-03 SEND_FAILED 통합 테스트 1개 통과. 전체 테스트는 재실행하지 않았다.
- 이번 단계 수정 파일의 diff 검사 통과. 전체 작업 트리에서는 별도 변경 README.md의 공백 오류 2건이 남아 있으며 수정하지 않았다.
- 명령·로그 경로·미검증 범위는 verification.md의 '2026-11-18 후속 마무리: 린트 정리와 빌드 검증' 절에 기록했다. 커밋하지 않았다.
