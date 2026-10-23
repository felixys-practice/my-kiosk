import { DomainNotFoundError } from 'src/common/errors/domain-not-found.error';

export class ProductNotFoundError extends DomainNotFoundError {
  constructor(readonly message: string) {
    super(message);
    this.name = 'ProductNotFoundError';
  }
}
