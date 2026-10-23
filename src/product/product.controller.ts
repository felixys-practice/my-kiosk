import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enum/role.enum';
import { ProductService } from './product.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  GetProductDto,
  GetProductOutDto,
  CreateProductDto,
  ProductParamDto,
  UpdateProductDto,
} from './dto';
import { PaginationResult } from 'src/common/pagination/pagination.types';
import { PaginationUtil } from 'src/common/pagination/pagination.util';

@ApiTags('products')
@Controller('shops/:shopId/products')
export class ProductController {
  constructor(private readonly service: ProductService) {}

  /**
   * 상품을 등록한다(이용권 종류별로 시간권·기간권 등록 경로를 탄다)
   * @param paramDto 매장 ID
   * @param dto 상품 정보(좌석 타입 포함)
   * @returns 생성한 상품 ID
   */
  @ApiOperation({ summary: '상품 생성' })
  @Post()
  async createProduct(
    @Param() paramDto: ProductParamDto,
    @Body() dto: CreateProductDto,
  ) {
    const shopId = paramDto.shopId;
    if (dto.type === 'TIME') {
      return await this.service.createTimeProduct(shopId, {
        ticketType: 'TIME',
        name: dto.name,
        amount: dto.amount,
        usableDays: dto.usableDays,
        isActive: dto.isActive,
        purchasedMinutes: dto.purchasedMinutes!,
        seatType: dto.seatType,
      });
    }
    return await this.service.createPeriodProduct(shopId, {
      ticketType: 'PERIOD',
      name: dto.name,
      amount: dto.amount,
      usableDays: dto.usableDays,
      isActive: dto.isActive,
      purchasedDurationDays: dto.purchasedDurationDays!,
      seatType: dto.seatType,
    });
  }

  /**
   * 상품을 수정한다(이용권 종류는 바꿀 수 없다)
   * @param shopId 매장 ID
   * @param productId 상품 ID
   * @param dto 바꿀 필드
   * @param userId 수정한 사용자 ID
   * @returns 없음
   */
  @ApiOperation({ summary: '상품 수정(이용권 종류 제외)' })
  @Roles(Role.OWNER, Role.MANAGER)
  @Patch(':productId')
  async updateProduct(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser('userId') userId: string,
  ): Promise<void> {
    await this.service.updateProduct(shopId, productId, dto, userId);
  }

  @ApiOperation({ summary: '상품 목록 조회(좌석 타입 포함)' })
  @Get()
  async getProducts(
    @Param() paramDto: ProductParamDto,
    @Query() dto: GetProductDto,
  ): Promise<PaginationResult<GetProductOutDto>> {
    return await this.service.getProducts(
      paramDto.shopId,
      PaginationUtil.normalize(dto),
      dto.type,
    );
  }
}
