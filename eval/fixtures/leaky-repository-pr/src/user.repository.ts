import { UserEntity } from './user.entity.js';

/**
 * Repository that leaks the raw DB entity (UserEntity) instead of returning
 * a domain model. This is the anti-pattern the LLM reviewer should detect.
 */
export class UserRepository {
  private readonly store: Map<number, UserEntity> = new Map();
  private nextId = 1;

  /**
   * Leaky abstraction: returns raw UserEntity instead of a domain User model.
   * Callers now depend on the DB schema, coupling business logic to persistence.
   */
  findById(id: number): UserEntity | undefined {
    return this.store.get(id);
  }

  /**
   * Leaky abstraction: accepts raw UserEntity instead of a domain model.
   */
  save(entity: UserEntity): UserEntity {
    entity.id = this.nextId++;
    entity.createdAt = new Date();
    this.store.set(entity.id, entity);
    return entity;
  }

  /**
   * Leaky abstraction: returns array of raw entities.
   */
  findAll(): UserEntity[] {
    return Array.from(this.store.values());
  }
}
