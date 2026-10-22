import { Injectable } from '@nestjs/common';
import { ProductRepository } from './product.repository';
import { randomUUID } from 'crypto';
import { ProductFieldMismatchError } from './errors/product-field-mismatch.error';
import { ProductNotFoundError } from './errors/product-not-found.error';
import {
  CreatePeriodProductData,
  CreateTimeProductData,
  ProductHistoryRow,
  UpdatableProductFields,
} from './product.type';
import { TicketType } from '@prisma/client';
import { GetProductOutDto, UpdateProductDto } from './dto';
import {
  PaginationOptions,
  PaginationResult,
} from 'src/common/pagination/pagination.types';

@Injectable()
export class ProductService {
  constructor(private readonly repository: ProductRepository) {}

  async createTimeProduct(
    shopId: string,
    data: CreateTimeProductData,
  ): Promise<string> {
    // TODO: 시간권 전용 검수 비지니스 로직 추가
    return await this.repository.createProduct(shopId, data);
  }
  async createPeriodProduct(
    shopId: string,
    data: CreatePeriodProductData,
  ): Promise<string> {
    // TODO: 정기권 전용 검수 비지니스 로직 추가
    return await this.repository.createProduct(shopId, data);
  }

  /**
   * 상품을 수정하고 바뀐 필드마다 변경 이력을 남긴다(research R8)
   * @param shopId 매장 ID
   * @param productId 상품 ID
   * @param dto 바꿀 필드(이용권 종류 제외)
   * @param userId 수정한 사용자 ID
   * @returns 없음
   * @throws ProductNotFoundError 상품이 없거나 삭제됐거나 다른 매장 상품일 때
   * @throws ProductFieldMismatchError 이용권 종류에 맞지 않는 필드를 보냈을 때
   */
  async updateProduct(
    shopId: string,
    productId: string,
    dto: UpdateProductDto,
    userId: string,
  ): Promise<void> {
    // 현재 값 조회
    const product = await this.repository.findProductForUpdate(
      shopId,
      productId,
    );

    // 삭제됐거나 다른 매장 상품이면 404
    if (!product) throw new ProductNotFoundError('상품을 찾을 수 없습니다');

    // 시간권에는 이용 기간을 넣을 수 없다
    if (
      product.ticketType === TicketType.TIME &&
      dto.purchasedDurationDays !== undefined
    ) {
      throw new ProductFieldMismatchError(
        '시간권 상품에는 이용 기간(purchasedDurationDays)을 지정할 수 없습니다',
      );
    }

    // 기간권에는 이용 시간을 넣을 수 없다
    if (
      product.ticketType === TicketType.PERIOD &&
      dto.purchasedMinutes !== undefined
    ) {
      throw new ProductFieldMismatchError(
        '기간권 상품에는 이용 시간(purchasedMinutes)을 지정할 수 없습니다',
      );
    }

    // 요청에 들어온 필드만 바꿀 대상으로 모은다
    const data: UpdatableProductFields = {};
    const fields = Object.keys(dto) as (keyof UpdatableProductFields)[];
    for (const field of fields) {
      if (dto[field] !== undefined) {
        Object.assign(data, { [field]: dto[field] });
      }
    }

    // 기존 값과 다른 필드만 같은 변경 묶음 ID로 이력을 만든다
    const changeGroupId = randomUUID();
    const histories: ProductHistoryRow[] = fields
      .filter((field) => data[field] !== undefined)
      .filter((field) => data[field] !== product[field])
      .map((field) => ({
        changeGroupId,
        changedField: field,
        oldValue: toHistoryValue(product[field]),
        newValue: toHistoryValue(data[field]),
        changedBy: userId,
      }));

    // 상품 갱신과 이력 저장을 한 트랜잭션으로 처리한다
    await this.repository.updateProductWithHistories(
      productId,
      data,
      histories,
    );
  }

  async getProducts(
    shopId: string,
    paginationOptions: Required<PaginationOptions>,
    type?: TicketType,
  ): Promise<PaginationResult<GetProductOutDto>> {
    return await this.repository.getProduct(shopId, {
      paginationOptions,
      ticketType: type,
    });
  }
}

/**
 * 이력 저장용 문자열로 바꾼다
 * @param value 필드 값
 * @returns 문자열, 값이 없으면 null
 */
function toHistoryValue(
  value: string | number | boolean | null | undefined,
): string | null {
  return value === null || value === undefined ? null : String(value);
}
