import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;

if (supabaseUrl && supabaseKey) {
  try {
    client = createClient(supabaseUrl, supabaseKey);
  } catch (err) {
    console.warn(
      "[AI Studio] Failed to initialize Supabase client, using in-memory mock:",
      err,
    );
  }
}

// In-memory mock store when Supabase is not configured
interface MockRow {
  [key: string]: unknown;
  id?: string;
  user_id?: string;
  created_at?: string;
  symbol?: string;
}

interface MockQueryBuilder {
  select: () => MockQueryBuilder;
  eq: (column: string, value: unknown) => MockQueryBuilder;
  limit: (n: number) => MockQueryBuilder;
  order: (
    column: string,
    options?: { ascending?: boolean },
  ) => MockQueryBuilder;
  insert: (
    values: Record<string, unknown>,
  ) => Promise<{ data: MockRow; error: null }>;
  delete: () => {
    eq: (
      column: string,
      value: unknown,
    ) => Promise<{ data: null; error: null }>;
  };
  then: (
    resolve: (value: { data: MockRow[]; error: null }) => void,
    reject: (reason?: unknown) => void,
  ) => Promise<void>;
}

const inMemoryTables: Record<string, MockRow[]> = {
  watchlist: [],
  analysis_history: [],
};

function createMockQueryBuilder(table: string): MockQueryBuilder {
  let filtered = [...(inMemoryTables[table] || [])];

  const builder: MockQueryBuilder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filtered = filtered.filter((row) => row[column] === value);
      return builder;
    },
    limit: (n: number) => {
      filtered = filtered.slice(0, n);
      return builder;
    },
    order: (
      column: string,
      { ascending = true }: { ascending?: boolean } = {},
    ) => {
      filtered.sort((a, b) => {
        const valA = (a[column] as string | number) ?? "";
        const valB = (b[column] as string | number) ?? "";
        if (valA < valB) return ascending ? -1 : 1;
        if (valA > valB) return ascending ? 1 : -1;
        return 0;
      });
      return builder;
    },
    insert: async (values: Record<string, unknown>) => {
      const row: MockRow = {
        id: "mock-" + Math.random().toString(36).slice(2, 9),
        user_id: "anon-user",
        created_at: new Date().toISOString(),
        ...values,
      };
      if (!inMemoryTables[table]) inMemoryTables[table] = [];
      inMemoryTables[table].push(row);
      return { data: row, error: null };
    },
    delete: () => {
      return {
        eq: async (column: string, value: unknown) => {
          if (inMemoryTables[table]) {
            inMemoryTables[table] = inMemoryTables[table].filter(
              (row) => row[column] !== value,
            );
          }
          return { data: null, error: null };
        },
      };
    },
    then: (
      resolve: (value: { data: MockRow[]; error: null }) => void,
      reject: (reason?: unknown) => void,
    ) => {
      return Promise.resolve({ data: filtered, error: null }).then(
        resolve,
        reject,
      );
    },
  };

  return builder;
}

const mockSupabase = {
  auth: {
    getSession: async () => ({
      data: { session: { user: { id: "mock-user" } } },
      error: null,
    }),
    signInAnonymously: async () => ({
      data: { session: { user: { id: "mock-user" } } },
      error: null,
    }),
  },
  from: (table: string) => createMockQueryBuilder(table),
} as unknown as SupabaseClient;

export const supabase: SupabaseClient = client || mockSupabase;
