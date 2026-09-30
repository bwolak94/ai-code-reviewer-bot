// VIOLATION: domain layer must not import from infrastructure layer.
// This import breaks the layer-dependency rule (domain: [] means no allowed imports).
import { DbRepository } from '../infrastructure/db.repository.js';

/** Domain service that incorrectly couples to the infrastructure layer. */
export class UserService {
  private readonly repo: DbRepository;

  constructor() {
    // Domain layer should never instantiate infrastructure directly.
    this.repo = new DbRepository('users');
  }

  findUser(id: string): string {
    return this.repo.query(`id = '${id}'`);
  }
}
