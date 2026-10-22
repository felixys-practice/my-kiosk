import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtValidationResult } from 'src/auth/interfaces/jwt-payload.interface';
import { TicketPauseService } from './ticket-pause.service';
import { PauseTicketDto, ResumeTicketDto } from './dto';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enum/role.enum';

@Roles(Role.OWNER, Role.MANAGER)
@Controller('tickets')
export class TicketPauseController {
  constructor(private readonly ticketPauseService: TicketPauseService) {}

  // 이용권 정지
  @Patch(':ticketId/pause')
  async pauseTicket(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @CurrentUser() user: JwtValidationResult,
    @Body() dto: PauseTicketDto,
  ): Promise<void> {
    await this.ticketPauseService.pauseTicket(
      ticketId,
      user.userId,
      dto.reason,
    );
  }

  // 이용권 재개
  @Patch(':ticketId/resume')
  async resumeTicket(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @CurrentUser() user: JwtValidationResult,
    @Body() dto: ResumeTicketDto,
  ): Promise<void> {
    await this.ticketPauseService.resumeTicket(
      ticketId,
      user.userId,
      dto.reason,
      dto.seatId,
    );
  }
}
