import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * 매장 환불 요청 본문 (API 계약 §4 매장: POST /refund/shop/:shopId)
 * - 금액 상한·사유 필수 여부·전액 원칙은 대상 판정 뒤 서비스에서 확인한다
 */
export class StoreRefundDto {
  @IsUUID('4', { message: '티켓 아이디는 유효한 UUID 형식이어야 합니다' })
  ticketId!: string;

  // 확정할 환불 금액(원 단위 정수). 0 이상(상한은 실결제액으로 서비스에서 확인)
  @IsInt()
  @Min(0)
  amount!: number;

  // 점주 사유(선택)
  @IsOptional()
  @IsString()
  reason?: string;

  // 이용 종료와 환불 금액에 대한 동의(누락·false 거절은 서비스에서)
  @IsOptional()
  @IsBoolean()
  consentToTerminateTicket?: boolean;

  // 이용 중일 때 퇴실 동의(누락·false 거절은 서비스에서 TICKET_IN_USE)
  @IsOptional()
  @IsBoolean()
  consentToEndSession?: boolean;
}
