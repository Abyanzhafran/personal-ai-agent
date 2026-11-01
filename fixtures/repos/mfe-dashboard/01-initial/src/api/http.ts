import axios from 'axios';

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 10_000,
});

// Pemanggil menerima isi body, bukan objek respons axios.
http.interceptors.response.use((res) => res.data);
