import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { forbidden } from '../../../common/errors/app-exception.js';

@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      throw forbidden('FORBIDDEN', 'Administrator permission required');
    }
    return true;
  }
}