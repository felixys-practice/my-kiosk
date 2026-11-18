# 환불 PG 구조 구현 후 검증 가이드

구현 후 사용할 절차이며 현재 기능 완료·테스트 통과 기록이 아니다. 명령 실행은 후속 검증 승인 범위다.

## QS 시나리오 대응표

QS 번호는 이 기능(003)에 속한다. 기존 001·002 테스트의 같은 번호와 혼동하지 않는다. 기존 테스트 이름은 이번 문서 작업에서 변경하지 않으며, 재사용 근거와 보완 범위는 [검증 기록](verification.md#t003-시나리오별-검증-계획)을 따른다. 표는 구현 후 검증 계획이며 통과 기록이 아니다.

| QS | 명세 인수 시나리오 | 확인 절차 | 기대 결과 |
| --- | --- | --- | --- |
| QS-1 | US1-1 전송 전 실패 | PG 서비스 대역으로 NOT_SENT를 반환하고 고객 환불 HTTP 요청을 실행한다. | REVOKED·ACCEPTED·ACTION_REQUIRED·FAILED/SEND_FAILED, 실제 지급액·원장 증가 없음 |
| QS-2 | US1-2 결과 불명 후 확정 미접수 | 환불 요청에 UNKNOWN을 반환하고 복구 조회에 authoritative NOT_FOUND를 반환한다. | 같은 PaymentCancel.id·금액으로 한도 내 재전송, 새 Refund 생성 없음 |
| QS-3 | US1-3 취소 성공 중복 수신 | 같은 취소 요청의 성공을 콜백·조회·즉시 응답 경로로 중복 반영한다. | 실제 지급액·원장 1회 반영, 기존 최종 결과 보호 |
| QS-4 | US1-4 승인액 불일치 시스템 환불 | 기존 서명 승인 콜백에 요청액과 다른 승인액을 전달한다. | 실제 승인액·FAILED·이용권 미발급·선점 해제·PAYMENT 대상 환불과 커밋 후 취소 보존 |
| QS-5 | US1-5 좌석 배정 실패 시스템 환불 | 기존 승인 처리에서 다른 이용자가 좌석을 먼저 확정한 상황을 재현한다. | 상품 대상 환불·REVOKED·배정 처리 보존, 새 구조로 커밋 후 취소 요청 |
| QS-6 | US2-1 실제 모의 구현의 즉시 성공 | 실제 SimulatedPgClient를 선택한 앱에 준비된 이용권의 환불 HTTP 요청을 보낸다. | 요청액 전액 취소·모의 거래 ID·PAID·실제액·원장, 외부 통신 없음 |
| QS-7 | US2-2 저장된 모의 취소 결과 조회 | 환불 HTTP 요청으로 생성한 취소 ID를 앱의 실제 클라이언트로 조회한다. | 최초 모의 취소 거래 ID·실제액과 동일한 결과 |
| QS-8 | US2-3 재시작 후 모의 기록 유실 | 앱 A의 환불 HTTP 요청으로 만든 취소 ID를 보관하고 앱을 종료한 뒤 앱 B로 재시작한다. | 기존 환불 HTTP 조회는 DB 상태 유지, 앱 B 클라이언트 조회는 QUERY_ERROR |
| QS-9 | US2-4 기록 없는 모의 취소 조회 | 환불 HTTP로 대상 환불을 준비하고 모의 결과가 없는 요청의 조회·후속 처리를 검증한다. | QUERY_ERROR, NOT_FOUND 미반환, 미접수 확정에 따른 재전송 없음 |
| QS-10 | US3-1 허용 구성의 시작 | development/test와 PG_MODE=simulated로 실제 앱을 시작한다. | 시작 성공·모드/클래스 로그·HTTP 응답 확인 |
| QS-11 | US3-2 운영 환경의 모의 구현 거부 | 기존 필수 설정은 유효하게 두고 production에서 simulated로 시작한다. | PG_MODE_FORBIDDEN·사유 안내·시작 실패, 비밀값 미노출 |
| QS-12 | US3-3 모드 누락·미지원 값 | PG_MODE 누락과 미지원 값을 각각 독립 사례로 실제 시작 시도한다. | PG_MODE_INVALID·사유 안내·시작 실패 |
| QS-13 | US3-4 미구현 운영용 골격 거부 | PG_MODE=production으로 운영용 골격을 선택하여 시작한다. | PG_IMPLEMENTATION_INCOMPLETE·미구현 사유·시작 실패 |
| QS-14 | US3-5 필수 설정 누락 거부 | 설정 누락을 반환하는 클라이언트 대역을 실제 provider 선택·검증 흐름에 연결해 시작한다. | PG_CONFIGURATION_MISSING·설정 항목명·시작 실패, 값 비노출 |

US1의 오류·중복 결과는 제어 가능한 PG 서비스 대역으로 검증한다. US2는 실제 모의 구현을 연결한 HTTP 흐름과 내부 클라이언트 조회를 함께 검증한다. US3의 시작 거부는 실제 시작 시도로 검증하며 HTTP 응답을 기대하지 않는다.

## 준비

- 기존 PostgreSQL·Redis와 JWT·콜백 서명 등 필수 설정을 준비한다. 민감값을 문서·로그에 복사하지 않는다.
- NODE_ENV=development, PG_MODE=simulated를 명시한다. 실제 운영 PG 자격 증명은 필요하지 않다.
- 환불 가능한 승인 완료 결제·미사용 이용권이 필요하다. 기존 `dev:scenario -- refund-unused`를 사용할 수 있다. 이 시드는 승인 성공 데이터를 직접 생성하므로 승인 로직 검증은 아니다.
- 실제 PG 승인·자동 승인 콜백·새 주문 결제 흐름은 이번 확인 범위가 아니다.

## 수동 환불 확인

저장소 루트에서 다음 명령을 순서대로 실행한다. 시드 실행은 DB에 데이터를 만든다.

```bash
npm run start:dev
```

다른 터미널에서 환불 대상을 만든다.

```bash
npm run dev:scenario -- refund-unused
```

1. 시작 로그에 simulated·SimulatedPgClient가 표시되는지 확인한다.
2. 시드 안내에 따라 Scalar에서 고객 인증 후 기존 환불 API를 호출한다. [시드 사용법](../../scripts/dev-scenario.md)을 따른다.
3. Ticket REVOKED, Refund ACCEPTED·PAID, PaymentCancel SUCCEEDED, 요청액과 같은 모의 실제액·환불 원장 1건을 확인한다.
4. 실제 외부 금전 거래가 없음을 모의 구현의 네트워크 비사용과 테스트로 확인한다. 모의 원장은 실제 외부 지급 증거가 아니다.

기존 HTTP 경로·동의·권한·응답은 [002 계약](../002-refund-completion/contracts/rest-api.md)을 따른다.

## 모의 조회·반복·재시작

환불 HTTP 요청으로 만들어진 PaymentCancel.id를 기준으로 앱의 실제 클라이언트를 조회한다. 같은 ID·금액은 같은 거래 ID·실제액을 반환한다. 재시작 후 또는 기록이 없는 요청은 QUERY_ERROR이며 NOT_FOUND로 판단해 재전송하지 않는다. 내부 조회를 위한 새 공개 API는 추가하지 않는다.

## 시작 거부

기존 필수 설정은 유효한 상태에서 PG_MODE 누락·미지원 값·production 환경의 simulated·운영용 골격 선택을 각각 확인한다. 각 구성은 사유를 알리고 시작을 거부해야 한다. 실제 서버 시작 검증을 수행하고 단위 함수 검사만으로 대체하지 않는다.

## 회귀·명령

별도 테스트 계획은 만들지 않는다. 단일 테스트 실행은 검증한 `.specify/memory/tdd-profile.md` 명령을 사용하고, 새 테스트 이름은 해당 태스크 실행 시 정한다. 기존 실행 경로는 다음과 같다. E2E는 테스트 DB에 영향을 준다.

```bash
npm run test -- src/pg/pg.service.spec.ts
npm run test:e2e
npx tsc --noEmit
npm run build
```

전체 단위 테스트는 `npm run test`다. lint는 자동 수정 명령 대신 `npx eslint <변경 파일>`을 사용한다. 기존 환불 동시성·복구·원장·승인액 불일치·좌석 실패 시스템 환불 회귀를 유지한다. 실제 PG·은행·다중 서버·영속 모의 상태는 검증 범위 밖이다.
