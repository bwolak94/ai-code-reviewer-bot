import type { User } from '../domain/user.js';

/** Infrastructure layer — imports from domain layer (allowed). */
export class UserRepository {
  private store: Map<string, User> = new Map();

  save(user: User): void {
    this.store.set(user.id, user);
  }

  findById(id: string): User | undefined {
    return this.store.get(id);
  }

  findAll(): User[] {
    return Array.from(this.store.values());
  }
}
