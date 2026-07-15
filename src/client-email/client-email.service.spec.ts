import { Test, TestingModule } from '@nestjs/testing';
import { ClientEmailService } from './client-email.service';

describe('ClientEmailService', () => {
  let service: ClientEmailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ClientEmailService],
    }).compile();

    service = module.get<ClientEmailService>(ClientEmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
