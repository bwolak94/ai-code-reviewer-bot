import type { User } from '../domain/user.js';
import { createUser } from '../domain/user.js';

/** Application-layer service — imports only from domain layer. */
export class UserService {
  private users: Map<string, User> = new Map();

  register(id: string, name: string, email: string): User {
    const user = createUser(id, name, email);
    this.users.set(id, user);
    return user;
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }
}
