import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares the permission codes a route requires, e.g.
 * `@Permissions('student:read', 'student:update')`. All listed codes must be
 * present on the caller (AND semantics). Enforced by PermissionsGuard.
 */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
