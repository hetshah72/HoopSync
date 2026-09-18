import type { DefaultSession } from "next-auth";
import type { Role } from "@/types/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }
}

// The `JWT` interface actually lives in @auth/core/jwt - next-auth/jwt just
// re-exports it, and augmenting a re-exporting module doesn't merge into the
// original declaration.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
