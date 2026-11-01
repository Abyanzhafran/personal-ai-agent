// jsdom tidak mengimplementasikan scrollTo; TanStack Router memanggilnya saat berpindah rute.
window.scrollTo = () => undefined;
