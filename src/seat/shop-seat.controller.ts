import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CreateSeatDto } from './dto/create-seat.dto';
import { SeatService } from './seat.service';
import { GetSeatOutDto } from './dto/get-seat-out.dto';

// Seat는 Shop에 종속된 리소스이므로 경로를 shop/:shopId/seat로 표현하되,
// SeatModule 소속(SeatService만 주입)으로 두어 Shop 도메인과는 분리한다.
// 경로 프리픽스(shop)와 소속 모듈은 별개이므로, 이 컨트롤러가 shop 도메인 로직을
// 갖는 것은 아니다.
@ApiTags('seats')
@Controller('shops/:shopId/seats')
export class ShopSeatController {
  constructor(private readonly service: SeatService) {}

  @ApiOperation({ summary: '좌석 등록' })
  @ApiParam({
    name: 'shopId',
    description: '매장 아이디',
    example: 'c7578f77-e52b-4e7e-9b9d-5b02f9696878',
  })
  @ApiBody({ type: CreateSeatDto })
  @Post()
  async createSeat(
    @Param('shopId') shopId: string,
    @Body() createSeatDto: CreateSeatDto,
  ): Promise<void> {
    await this.service.createSeat(
      shopId,
      createSeatDto.name,
      createSeatDto.number,
    );
  }

  @ApiOperation({ summary: '좌석 목록 조회' })
  @ApiParam({
    name: 'shopId',
    description: '매장 아이디',
    example: 'c7578f77-e52b-4e7e-9b9d-5b02f9696878',
  })
  @ApiOkResponse({ type: [GetSeatOutDto] })
  @Get()
  async getSeat(@Param('shopId') shopId: string): Promise<GetSeatOutDto[]> {
    return await this.service.getSeat(shopId);
  }
}
