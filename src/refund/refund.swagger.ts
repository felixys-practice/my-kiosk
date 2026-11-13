import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { ApiResponseSchemaHost } from '@nestjs/swagger';
import {
  ManualRefundPayoutStatus,
  PaymentCancelStatus,
  RefundDecisionStatus,
  RefundNotificationAudience,
  RefundPayoutMethod,
  RefundPayoutStatus,
  RefundSource,
  RefundRecoveryMode,
  RefundTargetKind,
} from '@prisma/client';

type SchemaObject = ApiResponseSchemaHost['schema'];

const text: SchemaObject = { type: 'string' };
const integer: SchemaObject = { type: 'integer' };
const boolean: SchemaObject = { type: 'boolean' };
const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const date: SchemaObject = { type: 'string', format: 'date-time' };
const nullable = (schema: SchemaObject): SchemaObject => ({
  ...schema,
  nullable: true,
});
const enumeration = (values: Record<string, string>): SchemaObject => ({
  type: 'string',
  enum: Object.values(values),
});
const object = (
  properties: Record<string, SchemaObject>,
  required = Object.keys(properties),
): SchemaObject => ({ type: 'object', properties, required });

export const refundAcceptanceSchema = object({
  refundId: uuid,
  decisionStatus: enumeration(RefundDecisionStatus),
  ticketId: uuid,
  amount: integer,
  payoutStatus: enumeration(RefundPayoutStatus),
  paymentCancelId: nullable(uuid),
  actionCode: nullable(text),
  acceptedAt: date,
  terminatedAt: date,
});

export const refundSchema = object({
  refundId: uuid,
  decisionStatus: enumeration(RefundDecisionStatus),
  policyVersion: text,
  paymentId: uuid,
  targetKind: enumeration(RefundTargetKind),
  orderItemId: nullable(uuid),
  ticketId: nullable(uuid),
  shopId: uuid,
  source: enumeration(RefundSource),
  amount: integer,
  paidAmount: integer,
  outstandingAmount: integer,
  overpaidAmount: integer,
  requestedAt: date,
  acceptedAt: nullable(date),
  terminatedAt: nullable(date),
  payoutStatus: enumeration(RefundPayoutStatus),
  payoutMethod: enumeration(RefundPayoutMethod),
  reviewRequired: boolean,
  paymentCancelId: nullable(uuid),
  attemptStatus: nullable(enumeration(PaymentCancelStatus)),
  actionCode: nullable(text),
  actionReason: nullable(text),
  paidAt: nullable(date),
});

const operatorReview = {
  reviewedById: nullable(uuid),
  reviewedAt: nullable(date),
  reviewReason: nullable(text),
  reviewEvidenceReference: nullable(text),
};
// 운영자 전용 필드는 일반 고객·점주 응답에서 제외한다.
const refundWithReview: SchemaObject = {
  ...refundSchema,
  properties: { ...refundSchema.properties, ...operatorReview },
  description:
    'reviewedById・reviewedAt・reviewReason・reviewEvidenceReference는 MANAGER에게만 반환합니다.',
};
const attempt = object({
  paymentCancelId: uuid,
  attemptNumber: integer,
  amount: integer,
  actualAmount: nullable(integer),
  status: enumeration(PaymentCancelStatus),
  failureCode: nullable(text),
  requestedAt: date,
  cancelledAt: nullable(date),
  failedAt: nullable(date),
});
const operatorAttempt = {
  pgTransactionId: nullable(text),
  pgErrorCode: nullable(text),
  failureReason: nullable(text),
  lastInquiryError: nullable(text),
  resendCount: integer,
  manualResendCount: integer,
  inquiryCount: integer,
  inquiryFailureCount: integer,
  lastInquiryAt: nullable(date),
  nextInquiryAt: nullable(date),
  queryFailedAt: nullable(date),
  lastSendAttemptAt: nullable(date),
  sendAttemptCount: integer,
  requestedById: nullable(uuid),
  retryReason: nullable(text),
};
const payout = object({
  manualRefundPayoutId: uuid,
  status: enumeration(ManualRefundPayoutStatus),
  amount: integer,
  reservedAt: date,
  confirmedAt: nullable(date),
  paidAt: nullable(date),
});
const operatorPayout = {
  externalTransactionId: nullable(text),
  evidenceReference: nullable(text),
  notPaidEvidence: nullable(text),
  failureReason: nullable(text),
  reason: text,
  reservedById: uuid,
  confirmedById: nullable(uuid),
};
export const refundDetailSchema: SchemaObject = {
  ...refundWithReview,
  properties: {
    ...refundWithReview.properties,
    attempts: {
      type: 'array',
      items: {
        ...attempt,
        properties: { ...attempt.properties, ...operatorAttempt },
        description:
          'PG 거래 식별자·오류·재시도 및 조회 이력은 MANAGER에게만 반환합니다.',
      },
    },
    manualPayouts: {
      type: 'array',
      items: {
        ...payout,
        properties: { ...payout.properties, ...operatorPayout },
        description:
          '거래 식별자·증빙·사유·담당자 정보는 MANAGER에게만 반환합니다.',
      },
    },
  },
  required: [...refundSchema.required!, 'attempts', 'manualPayouts'],
};

const meta = object({
  total: integer,
  page: integer,
  limit: integer,
  totalPages: integer,
  hasNextPage: boolean,
  hasPreviousPage: boolean,
  nextPage: nullable(integer),
  previousPage: nullable(integer),
});
const paginated = (item: SchemaObject) =>
  object({ items: { type: 'array', items: item }, meta });
export const refundListSchema = paginated(refundWithReview);
export const notificationSchema = object({
  notificationId: uuid,
  refundId: uuid,
  paymentCancelId: nullable(uuid),
  manualRefundPayoutId: nullable(uuid),
  kind: text,
  audience: enumeration(RefundNotificationAudience),
  shopId: uuid,
  message: text,
  createdAt: date,
  isRead: boolean,
  readAt: nullable(date),
});
export const notificationListSchema = paginated(notificationSchema);
export const pgCheckSchema = object({
  checkStatus: {
    type: 'string',
    enum: ['CHECKED', 'ALREADY_RUNNING', 'RECENT_RESULT', 'NO_PENDING_ATTEMPT'],
  },
  inquiryResult: nullable(text),
  resendResult: nullable(text),
  lastInquiryAt: nullable(date),
  lastInquiryFailed: boolean,
  refund: object({
    id: uuid,
    decisionStatus: enumeration(RefundDecisionStatus),
    amount: integer,
    paidAmount: integer,
    payoutStatus: enumeration(RefundPayoutStatus),
    actionCode: nullable(text),
  }),
});
export const retrySchema = object({
  refundId: uuid,
  paymentCancelId: uuid,
  payoutStatus: { type: 'string', enum: ['PENDING'] },
});
export const reservationSchema = object({
  refundId: uuid,
  payoutId: uuid,
  status: { type: 'string', enum: ['RESERVED'] },
  amount: integer,
});
export const confirmationSchema = object({
  refundId: uuid,
  payoutId: uuid,
  status: { type: 'string', enum: ['SUCCEEDED'] },
  amount: integer,
  payoutStatus: enumeration(RefundPayoutStatus),
});
export const notPaidSchema = object({
  refundId: uuid,
  payoutId: uuid,
  status: { type: 'string', enum: ['FAILED'] },
  payoutStatus: enumeration(RefundPayoutStatus),
});
export const reviewSchema = object({
  refundId: uuid,
  payoutStatus: { type: 'string', enum: ['PAID'] },
});
export const recoveryStatusSchema = object({
  mode: enumeration(RefundRecoveryMode),
  running: boolean,
  requestedCount: integer,
  queryFailedCount: integer,
  actionRequiredCount: integer,
  reservedManualCount: integer,
  oldestQueryFailedAt: nullable(date),
  nextProbeAt: nullable(date),
});
export const recoveryResumeSchema = object({
  status: { type: 'string', enum: ['SCHEDULED', 'ALREADY_RUNNING', 'NO_WORK'] },
});

/** 전역 TransformInterceptor가 만드는 성공 응답 형식을 문서화한다. */
export function ApiRefundResponse(
  status: number,
  description: string,
  data?: SchemaObject,
) {
  return ApiResponse({
    status,
    description,
    schema: object({
      success: { type: 'boolean', enum: [true] },
      statusCode: { type: 'integer', enum: [status] },
      ...(data ? { data } : {}),
      timestamp: date,
    }),
  });
}

/** HttpExceptionFilter의 오류 응답 형식. 각 API에서 발생할 수 있는 상태만 지정한다. */
export function ApiRefundErrors(...statuses: number[]) {
  const descriptions: Record<number, string> = {
    400: '입력 형식 또는 업무 조건 위반',
    401: '인증 실패',
    403: '접근 권한 없음',
    404: '대상을 찾을 수 없음',
    409: '멱등 키 충돌 또는 현재 처리 상태와 충돌',
    503: '처리 결과를 확정하지 못했거나 외부 서비스 이용 불가',
  };
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: descriptions[status],
        schema: object({
          success: { type: 'boolean', enum: [false] },
          statusCode: { type: 'integer', enum: [status] },
          error: object(
            {
              code: text,
              message: text,
              details: { description: '오류별 추가 정보' },
            },
            ['code', 'message'],
          ),
          timestamp: date,
          method: text,
          path: text,
        }),
      }),
    ),
  );
}
