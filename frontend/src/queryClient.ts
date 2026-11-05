import { QueryClient } from '@tanstack/react-query';

/** App-wide query client; a module singleton so AuthContext can clear it on sign-in/out. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 300_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
