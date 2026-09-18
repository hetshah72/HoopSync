import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library only auto-cleans when Vitest's `globals` option is on, and
// this project runs without it. Without this, every component render stays in
// the document and the next test's queries find several matches instead of one.
afterEach(cleanup);
