import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { JwtValidationResult } from 'src/auth/interfaces/jwt-payload.interface';
import { RefundForbiddenError } from '../errors';

/**
 * 환불 운영 변경 API의 MANAGER 전용 가드 (API 계약 §5)
 * - 본문 검증(ValidationPipe)보다 먼저 실행돼, 고객·점주는 사유 입력 여부와 관계없이 403 REFUND_FORBIDDEN을 받는다
 */
@Injectable()
export class RefundOperatorGuard implements CanActivate {
  /**
   * 요청자가 MANAGER인지 확인한다
   * @param context 실행 컨텍스트
   * @returns MANAGER면 true
   * @throws RefundForbiddenError MANAGER가 아닐 때(403)
   */
  canActivate(context: ExecutionContext): boolean {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: JwtValidationResult }>();
    if (user?.role !== UserRole.MANAGER) throw new RefundForbiddenError();
    return true;
  }
}
