import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtValidationResult } from 'src/auth/interfaces/jwt-payload.interface';
import { TicketPauseService } from './ticket-pause.service';
import { PauseTicketDto, ResumeTicketDto } from './dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enum/role.enum';

@ApiTags('tickets')
@Roles(Role.OWNER, Role.MANAGER)
@Controller('tickets')
export class TicketPauseController {
  constructor(private readonly ticketPauseService: TicketPauseService) {}

  // 이용권 정지
  @ApiOperation({ summary: '이용권 일시정지(고정석이면 배정 좌석 해제)' })
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

  /**
   * 일시정지된 이용권을 재개한다
   * - 이용권 재개
   * @param ticketId 이용권 ID
   * @param user 요청한 사용자
   * @param dto 재개 사유와 고정석 재배정 좌석
   * @returns 없음
   */
  @ApiOperation({
    summary: '이용권 재개(고정석이면 좌석 선택 필수, 다시 배정)',
  })
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
