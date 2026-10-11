import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Mock environment variables
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8000';
