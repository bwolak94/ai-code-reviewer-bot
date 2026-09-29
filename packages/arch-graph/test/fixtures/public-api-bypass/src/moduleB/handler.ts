import { AService } from '../moduleA/internal/a.service.js';

export class Handler {
  constructor(private readonly service: AService) {}

  handle(): string {
    return this.service.doSomething();
  }
}
