# 환불 API 확인용 데이터 준비

`dev-scenario.ts`는 고객 직접 환불을 확인할 수 있도록 개발용 데이터를 Prisma로 생성한다.
실제 주문·결제 API와 PG 승인 콜백을 거치지 않으며, 구매 흐름이나 정산 원장 검증용 데이터는 아니다.

## 실행 조건과 명령

프로젝트 루트에서 실행한다. `.env`를 읽으며, `NODE_ENV=development`와 로컬 PostgreSQL의 `DATABASE_URL`이 필요하다.
허용하는 DB 호스트는 `localhost`, `127.0.0.1`, `::1`이다. 해당 주소가 개발용 DB를 가리키는지 확인한다.

```bash
# 도움말만 출력한다. DB에 연결하지 않는다.
npm run dev:scenario -- --help

# DB에 데이터를 추가한다. 서버 실행은 필요하지 않다.
npm run dev:scenario -- refund-unused
```

## 생성 및 재사용 범위

- 고객 `dev-refund-customer@example.test`는 `USER`, 점주 `dev-refund-owner@example.test`는 `OWNER`로 준비한다.
- 두 계정의 개발용 비밀번호는 `DevRefund123!`이며 DB에는 bcrypt 해시로 저장한다.
- 고정 ID의 전용 계정·매장·자유석 시간권 상품을 재사용한다. 기존 정보가 예상 조건과 다르면 중단한다.
- 실행할 때마다 새 주문·주문 상품·결제·이용권을 추가한다. 이전 실행의 주문과 이용권도 유지한다.
- 실결제액은 10,000원이고, 구매 시간과 남은 시간은 모두 600분이다. 소진 기한은 생성 시각에서 30일 후다.
- 결제는 `Payment.status=SUCCESS`, 이용권은 `Ticket.status=UNUSED`로 만든다. 이용 세션과 환불 기록은 만들지 않는다.
- 생성 작업은 하나의 트랜잭션에서 처리한다. 오류가 발생하면 해당 실행의 변경은 롤백한다.
- 기존 데이터를 삭제하거나 기존 계정의 비밀번호·기존 이용권 상태를 덮어쓰지 않는다.

## 출력과 확인 범위

생성 후 고객 이메일·고객 ID·매장 ID·상품 ID·주문 ID·주문 상품 ID·결제 ID·이용권 ID를 출력한다.
이 단계에서는 로그인 토큰 발급, 환불 요청, 실제 PG 승인·취소를 수행하지 않는다.

## Scalar에서 환불 요청

1. API 서버를 실행하고 `/reference`에 접속한다. 기본 포트라면 `http://localhost:3000/reference`다.
2. `POST /auth/login`에 다음 본문을 입력해 로그인한다.

```json
{
  "email": "dev-refund-customer@example.test",
  "password": "DevRefund123!"
}
```

3. 로그인 응답의 `data.accessToken`을 Scalar 인증 설정의 `access-token` Bearer 토큰 입력란에 넣는다.
4. `POST /refund`에 다음 본문을 입력한다. `ticketId`는 스크립트가 이번 실행에서 출력한 실제 이용권 ID로 바꾼다.

```json
{
  "ticketId": "이번 실행에서 출력한 이용권 UUID",
  "consentToTerminateTicket": true
}
```

5. 요청을 실행하고 응답을 확인한다. 환불이 확정되면 이용권이 종료되므로, 새로운 환불을 확인하려면 스크립트를 다시 실행해 새 이용권을 준비한다.

스크립트는 로그인 토큰이나 환불 요청 본문을 자동으로 출력하지 않는다. 로그인과 환불 요청은 위 절차에 따라 수동으로 실행한다.
