import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResumeTicketDto } from './resume-ticket.dto';

describe('ResumeTicketDto', () => {
  it('재배정할 좌석 ID가 UUID가 아니면 isUuid 오류다', async () => {
    const dto = plainToInstance(ResumeTicketDto, { seatId: 'abc' });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    const seatIdError = errors.find((e) => e.property === 'seatId');
    expect(seatIdError?.constraints).toHaveProperty('isUuid');
  });
});
