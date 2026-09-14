import { useQuery } from '@tanstack/react-query';

export type ServiceStatus = 'online' | 'offline' | 'checking';

export function useServiceStatus() {
  return useQuery({
    queryKey: ['service-status'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/healthz');
        if (!response.ok) {
          throw new Error('Service unavailable');
        }
        return 'online' as ServiceStatus;
      } catch (error) {
        return 'offline' as ServiceStatus;
      }
    },
    refetchInterval: 10000, // Poll every 10 seconds
    retry: false,
    initialData: 'checking' as ServiceStatus,
  });
}
