import { INestApplication } from '@nestjs/common';

/**
 * 테스트 앱을 127.0.0.1의 임시 포트로 띄운다
 * - supertest는 요청을 127.0.0.1:포트로 보낸다. 앱을 IPv6 전체 주소(::)로 띄우면 같은 포트 번호를
 *   127.0.0.1로 이미 쓰는 다른 프로그램이 요청을 받을 수 있어(간헐 401·403·404·426·500) 주소를 고정한다
 * @param app 초기화 전 테스트 앱
 */
export async function listenOnLoopback(app: INestApplication): Promise<void> {
  await app.listen(0, '127.0.0.1');
}
