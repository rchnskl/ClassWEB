/** The principal attached to every authenticated request by JwtStrategy. */
export interface AuthenticatedUser {
  id: string;
  universityId: string;
  email: string;
  roleCodes: string[];
  /** Flattened set of "resource:action" permission codes across all roles. */
  permissions: string[];
}
