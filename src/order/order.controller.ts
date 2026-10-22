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
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { GetOrderQueryDto } from './dto/get-order-query.dto';
import { OrderOutData } from './order.types';

@Controller('orders')
export class OrderController {
  constructor(private readonly service: OrderService) {}

  @Post()
  async createOrder(@Body() dto: CreateOrderDto) {
    return await this.service.createOrder(
      dto.shopId,
      dto.userId,
      dto.orderedProducts,
    );
  }

  // 주문 취소(키오스크에서 뒤로 가기·취소 시 좌석 선점 해제, research R2)
  @Patch(':orderId/cancel')
  async cancelOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<void> {
    await this.service.cancelOrder(orderId);
  }

  @Get()
  async queryOrder(@Query() query: GetOrderQueryDto): Promise<OrderOutData[]> {
    return await this.service.getOrder(query.id, query.shopId, query.userId);
  }
}
