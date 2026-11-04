// Matcher `toHaveNoViolations` (vitest-axe) untuk test aksesibilitas; tipenya di vitest-axe.d.ts.
import * as matchers from 'vitest-axe/matchers';
import { expect } from 'vitest';

expect.extend(matchers);

// jsdom tidak mengimplementasikan scrollTo; TanStack Router memanggilnya saat berpindah rute.
window.scrollTo = () => undefined;
