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

  @ApiOperation({ summary: '이용권 좌석 변경(타입 변경·고정석 이동)' })
  @Patch(':ticketId/seat')
  async changeSeat(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: ChangeTicketSeatDto,
    @CurrentUser('userId') userId: string,
  ): Promise<void> {
    await this.ticketSeatService.changeSeat(ticketId, dto, userId);
  }

  @ApiOperation({ summary: '이용권 좌석 변경 이력(최신순)' })
  @Get(':ticketId/seat-changes')
  async getSeatChanges(@Param('ticketId', ParseUUIDPipe) ticketId: string) {
    return this.ticketSeatService.getSeatChanges(ticketId);
  }
}
