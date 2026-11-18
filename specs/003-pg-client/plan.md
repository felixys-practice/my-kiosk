# Implementation Plan: 환불 PG 호출 구조 정리와 구현 분리

**Branch**: `feature/pg-client` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)
**상태**: Phase 1~5 구현·검증·문서 검수 완료. 실제 운영 PG 통신은 미구현이다. 실행 근거와 미확인 범위는 verification.md를 따른다.

## Summary

환불 전송·복구·재시도 서비스 → PgService → PgClient로 취소 요청·결과 조회를 정리한다. 기존 RefundPgGateway·PgCancelClient와 토큰을 제거한다. 운영용 골격·개발용 모의 취소·조회와 환경 선택·시작 검증을 제공한다.

결제 승인 요청·모의 승인·자동 HTTP 콜백·승인 저장 메서드 변경은 별도 브랜치로 이관한다. 기존 결제 승인 코드와 그 코드가 시작하는 시스템 환불은 보존한다. 자세한 논의는 [인계 문서](payment-handoff.md)에 남긴다.

## Technical Context

- **Language/Version**: TypeScript 5.x, ES2023, 기존 Node.js 서버. 의존 범위는 package.json 기준이며 설치 버전을 실행 검증하지 않았다.
- **Primary Dependencies**: NestJS 11, Prisma 7, Joi, 기존 Redis/BullMQ. 새 런타임 패키지 없음.
- **Storage**: 업무 DB·큐는 유지. 모의 취소 결과는 Map만 사용. 스키마·마이그레이션 변경 없음.
- **Testing**: Vitest, Nest TestingModule, supertest. tasks.md의 T002에서 현재 Vitest 구성과 실행 명령을 확인하고 테스트 프로필을 갱신한다.
- **Target Platform / Project Type**: 기존 Nest 서버. 모의 결과는 단일 개발 프로세스에만 보관.
- **Performance Goals**: 새 처리량 목표 없음. 기존 REFUND_PG_TIMEOUT_SECONDS·리스 관계 유지.
- **Constraints**: 기존 002 업무·HTTP·멱등성·동시성·복구 보존. 실제 PG 통신과 결제 승인 설계는 제외.

## Constitution Check

| 원칙 | 설계 판단 | 반영 |
| --- | --- | --- |
| I 계층 | 충족 | PG 계층은 업무 DB·업무 서비스를 호출하지 않음 |
| II 입력 | 충족 | 기존 DTO·서명 유지, 내부 결과 필수 정보 검증 |
| III 테스트 | 충족 계획 | 업무는 HTTP E2E, 시작 거부는 v1.6.0의 실제 시작 검증. TDD·실패 증거·회귀·mutation은 구현 단계 수행 |
| IV 운영 수준 | 승인 범위 | 요청받은 운영 골격은 실제 통신을 꾸미지 않고 시작 거부 |
| V 단순성 | 충족 | 외부 저장소·빈 승인 메서드·자동 콜백 프레임워크 없음 |
| VI 오류 | 충족 | 기존 HTTP 오류 유지, 시작 검증 코드는 HTTP 오류와 구분 |

설계 점검이며 테스트 통과를 의미하지 않는다. 헌법 v1.6.0 개정은 유지한다.

## Project Structure

### Documentation

spec.md, plan.md, research.md, data-model.md, contracts/pg-client.md, quickstart.md, checklists/requirements.md를 현재 환불 범위에 맞춘다. payment-handoff.md는 별도 결제 작업 인계다. 작업은 tasks.md를 기준으로 진행한다. 별도 테스트 계획은 만들지 않으며, 실패 확인 기록은 구현 중 tdd/cycle-log.md에 남긴다.

### Source Code 변경 대상

| 대상 | 변경 |
| --- | --- |
| src/pg/pg.client.ts | PgClient·PG_CLIENT·시작 검증 타입. 취소 요청·조회만 정의 |
| src/pg/production-pg.client.ts | 운영용 취소·조회 골격, 미구현 오류·시작 거부 |
| src/pg/simulated-pg.client.ts | 즉시 취소 성공·메모리 조회·재요청 결과 일관성 |
| src/pg/pg.service.ts·pg.types.ts·pg.module.ts | 새 주입 계약·명명·공통 timeout·오류·결과 검증·구현 선택 |
| src/pg/pg-cancel.client.ts·refund-pg.gateway.ts | 호출처 전환 후 제거. 기존 취소 결과 타입은 유지 |
| src/refund/refund-acceptance-execution.service.ts | PgService 직접 주입과 requestPaymentCancel 호출로 전환. 확정 커밋·최초 전송·응답 저장·멱등 복구 순서 유지 |
| src/refund/refund-dispatch.service.ts·refund-recovery.service.ts·refund-retry.service.ts | PgService 직접 주입·메서드명 변경. 기존 업무 조건 유지 |
| src/config/configuration.ts·validation.schema.ts, .env.example | 필수 PG_MODE·환경 조합·구현 준비 확인. 승인 설정 추가 없음 |
| test/setup-env.ts·테스트 앱 설정 | PG_MODE=simulated 명시, 시작 거부 테스트의 설정 격리 |
| src/pg/pg.service.spec.ts·test/helpers/refund-pg.stub.ts·관련 refund E2E | 새 대역·명명·부트스트랩·업무 결과·복구 검증 |

PaymentService·PaymentRepository·PaymentModule은 변경 대상이 아니다. PG 서비스 안의 기존 미사용 승인 임시 메서드도 이번에는 유지하며 제거·교체는 별도 결제 작업에서 판단한다.

PgModule은 RefundModule·PaymentModule을 import하지 않는다. 전역 모듈로 등록하지 않고 PgService를 exports에 등록한다. RefundModule이 PgModule을 imports에 등록하여 사용한다. 모의 구현은 HttpAdapterHost·자동 콜백·HTTP 송신 코드를 필요로 하지 않는다.

## 메서드와 호출 순서

[계약](contracts/pg-client.md)에 따라 requestPaymentCancel·inquirePaymentCancel을 PgService와 PgClient에 같은 이름으로 둔다.

1. 기존 환불 확정 트랜잭션이 이용 종료·금액·최초 취소 요청·담당을 저장한다.
2. 커밋 후 고객·매장 환불의 최초 요청은 RefundAcceptanceExecutionService.sendAccepted가 PgService.requestPaymentCancel을 호출하고 RefundDispatchService.recordSendResult에 결과 반영을 맡긴다. 시스템 환불 전송과 재전송은 RefundDispatchService가 PgService.requestPaymentCancel을 호출한다.
3. 서비스는 선택된 클라이언트를 제한 시간 안에 호출한다.
4. 즉시 성공이면 기존 결과 서비스가 실제액·원장·지급 상태를 반영한다. 미확정이면 기존 일정으로 조회한다.
5. 복구·재시도 서비스는 PgService.inquirePaymentCancel을 호출하고 기존 상태별 규칙을 적용한다.

기존 승인 콜백이 만드는 시스템 환불도 1~5의 환불 경로로 이어진다. 승인 결과 반영은 바꾸지 않는다.

## 변경 순서

각 새 동작은 테스트 하나의 실패 확인부터 구현한다. 목록은 단계 간 순서다.

1. 공통 타입과 테스트 실행 환경을 준비하고 기존 앱 연결은 유지한다.
2. 모의 클라이언트·운영용 골격을 기존 연결과 분리하여 한 동작씩 테스트·구현한다.
3. 설정·서버 시작 검증의 사례를 준비한다. 실제 실패 확인과 구현은 다음 구조 전환에서 한 사례씩 진행한다.
4. PgService·환불 호출처·provider·기존 테스트 대역·필수 PG_MODE 설정을 함께 전환한다. 해당 태스크 묶음은 tasks.md의 “구조 전환 작업”을 따른다. 일부 변경만으로 완료 처리하지 않으며 타입 검사와 기존 회귀 통과를 완료 조건으로 삼는다.
5. 새 구성의 모의 취소·조회·시작 검증과 기존 시스템 환불·동시성·복구를 확인한다.
6. 구형 인터페이스·토큰·가상 응답 타입·미연동 구현을 제거하고 전체 회귀를 확인한다. 기존 승인 코드는 유지한다.
7. 관련 002 설계·PG 안내·문서·타입·빌드·변경 파일 lint를 확인한다.

승인 인터페이스 확장은 미래 결제 브랜치의 별도 설계다. 두 브랜치 통합 시 PgModule 변경을 대조하며, 현재 범위에서 미래 호출처를 위한 빈 메서드를 만들지 않는다.

## 테스트 대응표

| 요구·계약 | 검증 |
| --- | --- |
| SR-001~005, SC-006~009 | 호출처·import·DI 정적 검토, 기본 provider와 제거 대상 확인 |
| FR-004·기존 §8 | PgService 테스트에서 PG_CLIENT 교체. timeout·일반 예외·필수 정보·즉시 성공·조회 결과 |
| FR-005~006, US1 | 기존 환불 E2E는 PgService를 취소·조회 대역으로 교체. 상태·실제액·원장·호출 횟수·락·리스·한도 검증 |
| FR-007, US1 4·5항 | 기존 승인액 불일치·좌석 배정 실패·콜백 서명·중복 발급 회귀. 승인 코드 수정 없음 |
| FR-008·014, US2 | 실제 모의 구현을 연결한 앱의 환불 HTTP 흐름과 내부 취소 조회·재시작 유실 검증 |
| FR-010·011, US3 | 실제 서버 시작 시도·거부 사유·실패와 허용 구성의 HTTP 동작, 민감 정보 비노출 |

US2의 내부 조회 결과는 앱에 주입된 실제 클라이언트에서 확인하되, 각 인수 시나리오는 환불 HTTP 요청으로 만든 요청을 기준으로 한다. 앱 재시작 시나리오는 시작 후 기존 환불 조회 API도 호출하고 메모리 결과를 확인한다. 공개 조회 API를 추가하지 않는다.

기존 업무 기대값을 바꿔야 하면 사용자 확인을 받는다. 구조에 종속된 부트스트랩·가상 응답 형식 검증은 같은 의미의 새 계약 검증으로 옮긴다. 테스트 삭제·완화로 회귀를 숨기지 않는다.

## 기존 문서 갱신 대상

| 문서 | 변경 |
| --- | --- |
| 002 research.md PG 결정 | 개발 환경의 명시적 모의 취소·조회 허용, 운영 모의 금지 유지 |
| 002 plan.md | PgService·PgClient 경계·테스트 대역·시작 검증에 003 참조 |
| 002 contracts/rest-api.md §8 | 결과·상태·재전송 보존. 미연동 실행과 시작 검증 설명을 구분 |
| AGENTS.md·.env.example | 환불 PG 경계·PG_MODE·운영 골격 한계를 실제 구현과 일치 |

002 tasks·cycle-log·제출 검증 기록은 과거 증거라 다시 쓰지 않는다. 기존 002 문서의 실제 수정은 후속 구현 범위다.

## Complexity Tracking

새 업무 계층·외부 저장소는 추가하지 않는다. 기존 취소·조회 추상화를 PgClient로 대체하며 운영용 골격·개발용 모의 구현만 분리한다. 이전 자동 승인 콜백·저장 완료 통지 복잡성은 이번 범위에서 제거했다.
