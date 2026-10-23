import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enum/role.enum';
import { ChangeTicketSeatDto } from './dto/change-ticket-seat.dto';
import { TicketSeatService } from './ticket-seat.service';

@ApiTags('tickets')
@Roles(Role.OWNER, Role.MANAGER)
@Controller('tickets')
export class TicketSeatController {
  constructor(private readonly ticketSeatService: TicketSeatService) {}

  /**
   * 이용권 좌석을 바꾼다(타입 변경·고정석 이동)
   * @param ticketId 이용권 ID
   * @param dto 바꿀 좌석 타입·좌석·사유
   * @param userId 변경한 점주 ID
   * @returns 없음
   */
  @ApiOperation({ summary: '이용권 좌석 변경(타입 변경·고정석 이동)' })
  @Patch(':ticketId/seat')
  async changeSeat(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: ChangeTicketSeatDto,
    @CurrentUser('userId') userId: string,
  ): Promise<void> {
    await this.ticketSeatService.changeSeat(ticketId, dto, userId);
  }

  /**
   * 이용권 좌석 변경 이력을 최신순으로 조회한다
   * @param ticketId 이용권 ID
   * @returns 변경 이력 목록
   */
  @ApiOperation({ summary: '이용권 좌석 변경 이력(최신순)' })
  @Get(':ticketId/seat-changes')
  async getSeatChanges(@Param('ticketId', ParseUUIDPipe) ticketId: string) {
    return this.ticketSeatService.getSeatChanges(ticketId);
  }
}
