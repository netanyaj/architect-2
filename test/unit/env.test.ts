import { describe, expect, it } from "vitest";
import { checkSupabaseUrl } from "@/lib/db";

describe("checkSupabaseUrl", () => {
  it("accepts the project API address (and a local Supabase)", () => {
    expect(checkSupabaseUrl("https://vxfrwdeesbxbxzgavpsz.supabase.co")).toBe("https://vxfrwdeesbxbxzgavpsz.supabase.co");
    expect(checkSupabaseUrl("https://vxfrwdeesbxbxzgavpsz.supabase.co/")).toBe("https://vxfrwdeesbxbxzgavpsz.supabase.co");
    expect(checkSupabaseUrl("http://localhost:54321")).toBe("http://localhost:54321");
  });
  it("refuses the dashboard address and says which URL to use", () => {
    expect(() => checkSupabaseUrl("https://supabase.com/dashboard/project/vxfrwdeesbxbxzgavpsz")).toThrow(
      "Use the API URL instead: https://vxfrwdeesbxbxzgavpsz.supabase.co",
    );
  });
  it("refuses a missing or odd value", () => {
    expect(() => checkSupabaseUrl(undefined)).toThrow("is not set");
    expect(() => checkSupabaseUrl("https://example.com")).toThrow("should look like");
  });
});
