import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject, ApiResponseSchemaHost } from '@nestjs/swagger';

import { RefundController } from './refund.controller';
import { RefundOperationsController } from './refund-operations.controller';
import { RefundNotificationController } from './refund-notification.controller';
import { RefundRecoveryController } from './refund-recovery.controller';
import { PgSignatureGuard } from '../pg/guards/pg-signature.guard';

type SchemaObject = ApiResponseSchemaHost['schema'];

/** DB·Redis·PG 연결 없이 실제 컨트롤러에서 생성한 API 문서를 검증한다. */
describe('Refund Swagger document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const controllers = [
      RefundController,
      RefundOperationsController,
      RefundNotificationController,
      RefundRecoveryController,
    ];
    const dependencies = new Set(
      controllers.flatMap(
        (controller) =>
          Reflect.getMetadata(
            'design:paramtypes',
            controller,
          ) as Type<unknown>[],
      ),
    );
    const module = await Test.createTestingModule({
      controllers,
      providers: [...dependencies].map((provide) => ({
        provide,
        useValue: {},
      })),
    })
      .overrideGuard(PgSignatureGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          'access-token',
        )
        .build(),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('documents all 17 endpoints with success schemas and the correct authentication', () => {
    let count = 0;
    for (const [path, item] of Object.entries(document.paths)) {
      for (const method of ['get', 'post', 'patch'] as const) {
        const operation = item[method];
        if (!operation) continue;
        count++;
        expect(operation.summary).toBeTruthy();
        expect(operation.tags).toContain('refund');
        expect(
          Object.entries(operation.responses).some(
            ([status, response]) =>
              status.startsWith('2') &&
              response &&
              'content' in response &&
              response.content?.['application/json']?.schema,
          ),
        ).toBe(true);
        expect(operation.security ?? []).toEqual(
          path === '/refund/callback' ? [] : [{ 'access-token': [] }],
        );
      }
    }
    expect(count).toBe(17);
    expect(
      document.components?.securitySchemes?.['access-token'],
    ).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('preserves dynamic HTTP statuses and documents key requirements and PG signatures', () => {
    expect(document.paths['/refund'].post?.responses).toHaveProperty('202');
    expect(document.paths['/refund'].post?.responses).toHaveProperty('200');
    expect(document.paths['/refund'].post?.responses).not.toHaveProperty('201');
    const key = (path: string) =>
      document.paths[path].post?.parameters?.find(
        (p) => 'name' in p && p.name.toLowerCase() === 'idempotency-key',
      );
    expect(key('/refund')).toMatchObject({ required: false });
    expect(
      document.paths['/refund'].post?.parameters?.filter(
        (p) => 'name' in p && p.name.toLowerCase() === 'idempotency-key',
      ),
    ).toHaveLength(1);
    expect(key('/refund/{refundId}/manual-payouts')).toMatchObject({
      required: true,
    });
    expect(document.paths['/refund/callback'].post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'X-Pg-Timestamp', required: true }),
        expect.objectContaining({ name: 'X-Pg-Signature', required: true }),
      ]),
    );
    expect(
      document.paths['/refund/recovery/resume'].post?.responses,
    ).toHaveProperty('202');
    const body =
      document.paths['/refund/{refundId}/pg-check'].post?.requestBody;
    expect(body).toMatchObject({
      required: false,
      content: {
        'application/json': { schema: { additionalProperties: false } },
      },
    });
  });

  it('emits nonempty DTO bodies, optional query filters, and paginated response fields', () => {
    const schemas = document.components!.schemas!;
    expect((schemas.RefundDto as SchemaObject).required).toEqual(['ticketId']);
    expect((schemas.RefundDto as SchemaObject).properties).toHaveProperty(
      'consentToTerminateTicket',
    );
    expect(
      (schemas.StoreRefundDto as SchemaObject).properties?.amount,
    ).toMatchObject({ minimum: 0 });
    expect(
      (schemas.ConfirmManualPayoutDto as SchemaObject).properties?.paidAt,
    ).toMatchObject({ type: 'string', format: 'date-time' });
    expect(document.paths['/refund/me'].get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'page', required: false }),
        expect.objectContaining({ name: 'payoutStatus', required: false }),
      ]),
    );
    const response = document.paths['/refund/me'].get!.responses['200'];
    if (!response || !('content' in response))
      throw new Error('Missing response schema');
    const schema = response.content!['application/json'].schema as SchemaObject;
    expect(schema.properties?.data).toMatchObject({
      properties: { items: { type: 'array' }, meta: { type: 'object' } },
    });
  });
});
