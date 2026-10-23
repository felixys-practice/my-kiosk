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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrderQueryDto } from './dto/get-order-query.dto';
import { OrderOutData } from './order.types';

@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(private readonly service: OrderService) {}

  @ApiOperation({
    summary: '주문 생성(고정석 상품은 좌석 선택 필수, 좌석은 선점된다)',
  })
  @Post()
  async createOrder(@Body() dto: CreateOrderDto) {
    return await this.service.createOrder(
      dto.shopId,
      dto.userId,
      dto.orderedProducts,
    );
  }

  /**
   * 주문을 취소하고 고정석 선점을 즉시 해제한다
   * - 주문 취소(키오스크에서 뒤로 가기·취소 시 좌석 선점 해제, research R2)
   * @param orderId 주문 ID
   * @returns 없음
   */
  @ApiOperation({ summary: '주문 취소(고정석 선점 즉시 해제)' })
  @Patch(':orderId/cancel')
  async cancelOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<void> {
    await this.service.cancelOrder(orderId);
  }

  @ApiOperation({ summary: '주문 조회' })
  @Get()
  async queryOrder(@Query() query: GetOrderQueryDto): Promise<OrderOutData[]> {
    return await this.service.getOrder(query.id, query.shopId, query.userId);
  }
}
