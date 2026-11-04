import { describe, expect, test } from "bun:test";
import { cn } from "./utils";

describe("cn", () => {
  test("merges conflicting utility classes and conditional values", () => {
    expect(cn("p-2 p-4", false && "p-6")).toBe("p-4");
  });

  test("keeps responsive and state variants independent", () => {
    expect(cn("p-2 sm:p-3 sm:hover:p-4", "sm:hover:p-5")).toBe(
      "p-2 sm:p-3 sm:hover:p-5",
    );
  });

  test("resolves arbitrary values, including Tailwind 4 variable syntax", () => {
    expect(cn("w-4", "w-[31px]")).toBe("w-[31px]");
    expect(cn("bg-red-500", "bg-(--surface)")).toBe("bg-(--surface)");
  });

  test("merges custom theme colors in light and dark variants", () => {
    expect(cn("bg-surface text-muted-foreground", "bg-primary text-foreground"))
      .toBe("bg-primary text-foreground");
    expect(cn("dark:bg-surface dark:text-muted-foreground", "dark:bg-primary dark:text-foreground"))
      .toBe("dark:bg-primary dark:text-foreground");
  });
});
