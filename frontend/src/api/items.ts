import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "./client";

// Mirror the backend ItemRead / ItemCreate schemas. Note: numeric DB types
// (e.g. Numeric) arrive as strings over JSON — type those `string`.
export interface Item {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  // Numeric arrives as a string over JSON; date as an ISO "YYYY-MM-DD" string.
  amount: string | null;
  date: string | null;
}

export interface ItemCreate {
  name: string;
  description?: string | null;
  category?: string | null;
  amount?: string | null;
  date?: string | null;
}

const ITEMS_KEY = ["items"] as const;

export function useItems() {
  return useQuery({
    queryKey: ITEMS_KEY,
    queryFn: () => apiFetch<Item[]>("/items"),
  });
}

export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ItemCreate) =>
      apiFetch<Item>("/items", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ITEMS_KEY });
    },
  });
}

export function useUpdateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ItemCreate }) =>
      apiFetch<Item>(`/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ITEMS_KEY });
    },
  });
}

export function useDeleteItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/items/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ITEMS_KEY });
    },
  });
}
