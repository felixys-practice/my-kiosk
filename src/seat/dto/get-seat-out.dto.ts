import { ApiProperty } from '@nestjs/swagger';
import { SeatType } from '@prisma/client';
import { UsageSessionOutDto } from 'src/usage-session/dto/usage-session-out.dto';

export class GetSeatOutDto {
  @ApiProperty({ description: '좌석 아이디' })
  id!: string;

  @ApiProperty({ description: '좌석 번호' })
  number!: number;

  @ApiProperty({ description: '좌석 이름' })
  name!: string;

  @ApiProperty({
    description: '좌석 타입 (FIXED: 고정석, FREE: 자유석)',
    enum: SeatType,
  })
  type!: SeatType;

  @ApiProperty({
    description:
      '고정석 선택 가능 여부(점유 중인 배정이 없으면 true). 자유석은 항상 false',
  })
  isAssignable!: boolean;

  @ApiProperty({
    description: '현재 좌석의 이용 세션 목록',
    type: [UsageSessionOutDto],
  })
  usageSession!: UsageSessionOutDto[];
}
