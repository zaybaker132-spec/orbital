import "express";
type Role = "owner" | "admin" | "member" | "viewer";
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; displayName: string };
      workspace?: { id: string; name: string; kind: "personal" | "business"; role: Role };
      apiToken?: { id: string; scopes: string[] };
    }
  }
}
export {};
