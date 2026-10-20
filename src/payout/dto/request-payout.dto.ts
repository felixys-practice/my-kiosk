import { IsString, IsUUID } from 'class-validator';

export class RequestPayoutDto {
  @IsUUID()
  settlementBatchId: string;

  @IsUUID()
  shopId: string;

  // TODO: 인증 도입 후 토큰에서 추출하도록 변경하고 이 필드는 제거한다.
  @IsString()
  requestedBy: string;
}
