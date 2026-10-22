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
