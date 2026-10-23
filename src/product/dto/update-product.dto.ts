import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

/**
 * 상품 수정 요청 DTO
 * - 이용권 종류(type)는 바꿀 수 없으므로 받지 않는다(research R8)
 * - 나머지 필드는 모두 선택 입력이다
 */
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['type'] as const),
) {}
