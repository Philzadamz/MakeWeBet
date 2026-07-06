import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';

/** Use AFTER JwtAuthGuard. SUPER_ADMIN passes every role check. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN' });
    if (user.role === 'SUPER_ADMIN') return true;
    if (!required.includes(user.role as UserRole)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }
    return true;
  }
}
