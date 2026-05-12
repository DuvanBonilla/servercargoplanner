import { Role } from '@prisma/client';

export class CurrentUserDto {
  userId!: number;
  siteId!: number | null;
  subsiteId!: number | null;
  role!: Role;
  isAdmin!: boolean;
  isSupervisor!: boolean;
  isProgrammer!: boolean;
  isSuperAdmin!: boolean;
  isGH!: boolean;
  username?: string;
  email?: string;
}