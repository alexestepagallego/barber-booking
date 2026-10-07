import { describe, expect, it } from "vitest";

import { findPgError, isConstraintViolation, PG_ERROR } from "@/server/db/errors";

const exclusion = { code: "23P01", constraint_name: "appointments_no_overlap" };

describe("findPgError", () => {
  it("finds the driver error when it is wrapped in cause chains", () => {
    const wrapped = new Error("query failed", {
      cause: new Error("tx failed", { cause: exclusion }),
    });
    expect(findPgError(wrapped)).toBe(exclusion);
  });

  it("returns undefined for non-database errors", () => {
    expect(findPgError(new Error("boom"))).toBeUndefined();
    expect(findPgError(null)).toBeUndefined();
    expect(findPgError({ code: 42 })).toBeUndefined();
  });
});

describe("isConstraintViolation", () => {
  const error = new Error("wrapped", { cause: exclusion });

  it("matches on SQLSTATE and, optionally, on constraint name", () => {
    expect(isConstraintViolation(error, PG_ERROR.exclusionViolation)).toBe(true);
    expect(
      isConstraintViolation(error, PG_ERROR.exclusionViolation, "appointments_no_overlap"),
    ).toBe(true);
    expect(isConstraintViolation(error, PG_ERROR.exclusionViolation, "other")).toBe(false);
    expect(isConstraintViolation(error, PG_ERROR.uniqueViolation)).toBe(false);
  });
});
