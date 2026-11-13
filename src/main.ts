import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true, // Winston 준비 전 발생하는 초기 로그 손실 방지
    rawBody: true, // PG 콜백 서명 검증용 파싱 전 원문 바이트(환불 명세 API 계약 §7)
  });

  // NestJS 기본 로거를 Winston으로 교체
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // Swagger 설정
  const config = new DocumentBuilder()
    .setTitle('키오스크')
    .setDescription('키오스크 플랫폼 백앤드 API 문서')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('refund', '환불 접수·조회 및 지급 운영')
    .addTag('shop', '매장 관리')
    .addTag('seat', '좌석 관리')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // 새로고침 시 JWT 토큰 유지
      tagsSorter: 'alpha', // 태그 알파벳 순 정렬
      operationsSorter: 'alpha', // 앤드포인트 알파벳 순 정렬
    },
  });

  app.use(
    '/reference',
    apiReference({
      content: document,
      persistAuth: true,
      authentication: {
        preferredSecurityScheme: 'access-token',
      },
      customCss: `
        .scalar-api-reference {
          --scalar-sidebar-width: 340px;
        }
      `,
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 없는 필드는 자동으로 제거
      forbidNonWhitelisted: true, // DTO에 없는 필드가 오면 400으로 거부
      transform: true, // 요청 바디를 DTO 클래스 인스턴스로 변환
    }),
  );
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
