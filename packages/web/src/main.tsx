import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createQueryClient } from './lib/query-client';
import './styles/globals.css';
import { createAppRouter } from './router';

const queryClient = createQueryClient();
const router = createAppRouter();

const container = document.getElementById('root');
if (!container) throw new Error('Elemen #root tidak ditemukan di index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
