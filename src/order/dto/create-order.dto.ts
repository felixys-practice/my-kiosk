import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/** 주문 항목 하나(상품·수량·고정석 좌석) */
export class OrderedProductDto {
  @ApiProperty({ description: '상품 아이디' })
  @IsUUID('4', { message: '상품 아이디는 유효한 UUID 형식이어야 합니다' })
  productId!: string;

  @ApiProperty({ description: '수량(1 이상)' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({
    description:
      '고정석 상품이면 필수인 좌석 아이디(자유석 상품은 보내지 않는다)',
    required: false,
  })
  @IsOptional()
  @IsUUID('4', { message: '좌석 아이디는 유효한 UUID 형식이어야 합니다' })
  seatId?: string;
}

export class CreateOrderDto {
  @ApiProperty({ description: '매장 아이디', required: true })
  @IsUUID('4', { message: '매장 아이디는 유효한 UUID 형식이어야 합니다' })
  shopId!: string;

  @ApiProperty({ description: '사용자 아이디', required: true })
  @IsUUID('4', { message: '사용자 아이디는 유효한 UUID 형식이어야 합니다' })
  userId!: string;

  @ApiProperty({ description: '주문 항목 목록', type: [OrderedProductDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderedProductDto)
  orderedProducts!: OrderedProductDto[];
}
