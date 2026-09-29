import { UserRepository } from '../infrastructure/user.repository.js';

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  getUser(id: string): string {
    return this.repo.findById(id);
  }
}
