/**
 * TypeORM-style entity class — decorated with @Entity.
 * This is a raw DB entity that should not leak beyond the repository layer.
 */

// Simulated TypeORM decorator (no actual typeorm dependency needed for static analysis)
function Entity(): ClassDecorator {
  return () => undefined;
}

function Column(): PropertyDecorator {
  return () => undefined;
}

function PrimaryGeneratedColumn(): PropertyDecorator {
  return () => undefined;
}

@Entity()
export class UserEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  email!: string;

  @Column()
  passwordHash!: string;

  @Column()
  createdAt!: Date;
}
