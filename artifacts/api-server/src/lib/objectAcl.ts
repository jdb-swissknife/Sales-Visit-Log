/**
 * Object ACL types (simplified). The actual ACL enforcement is currently a
 * no-op in ObjectStorageService — all storage route ACL checks are commented
 * out. When authentication is added, persist policies as R2 object metadata
 * and enforce here.
 */

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
}
