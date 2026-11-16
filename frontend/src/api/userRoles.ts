import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { Role } from "../lib/role";
import { apiFetch } from "./client";

// Mirrors the backend's schemas/user_role.py. Admins only (/api/user-roles).
export interface UserRole {
  id: number;
  email: string;
  /** Directory display name copied by the people picker; null on older rows. */
  display_name: string | null;
  role: Role;
  created_at: string;
  updated_at: string;
}

const KEY = ["user-roles"] as const;

export function useUserRoles() {
  return useQuery({ queryKey: KEY, queryFn: () => apiFetch<UserRole[]>("/user-roles") });
}

export function useCreateUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; role: Role; display_name: string | null }) =>
      apiFetch<UserRole>("/user-roles", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) =>
      apiFetch<UserRole>(`/user-roles/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/user-roles/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
