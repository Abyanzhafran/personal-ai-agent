// Matcher `toHaveNoViolations` (vitest-axe) untuk test aksesibilitas; impor `extend-expect` memberi tipenya.
import 'vitest-axe/extend-expect';
import * as matchers from 'vitest-axe/matchers';
import { expect } from 'vitest';

expect.extend(matchers);

// jsdom tidak mengimplementasikan scrollTo; TanStack Router memanggilnya saat berpindah rute.
window.scrollTo = () => undefined;
