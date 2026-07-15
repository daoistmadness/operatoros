import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../button";
import { Dialog, DialogContent, DialogTitle } from "../dialog";
import { FieldDescription, FieldLabel, FormField } from "../field";
import { FieldError } from "../field-error";
import { Form } from "../form";
import { Input } from "../input";
import { NativeSelect } from "../native-select";
import { Textarea } from "../textarea";

describe("form primitive contracts", () => {
  it("renders children and associates label, control, description, and error", () => {
    const html = renderToStaticMarkup(
      <FormField id="email" required invalid>
        <FieldLabel>Email address</FieldLabel>
        <FieldDescription>Use your school address.</FieldDescription>
        <Input />
        <FieldError>Email address is required</FieldError>
      </FormField>,
    );

    expect(html).toContain('for="email"');
    expect(html).toContain('id="email"');
    expect(html).toContain('required=""');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="email-description email-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Email address is required");
    expect(html).toContain("required</span>");
  });

  it("announces multiple validation messages as one accessible list", () => {
    const html = renderToStaticMarkup(
      <FormField id="password" invalid>
        <FieldError errors={["Password is required", "Use at least 12 characters"]} />
      </FormField>,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("<ul");
    expect(html).toContain("Password is required");
    expect(html).toContain("Use at least 12 characters");
  });

  it("does not render an empty error announcement", () => {
    expect(renderToStaticMarkup(<FieldError />)).toBe("");
  });

  it("propagates disabled state and preserves visible focus and error classes", () => {
    const html = renderToStaticMarkup(<FormField id="name" disabled invalid><Input /></FormField>);
    expect(html).toContain("disabled");
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("aria-invalid:border-danger");
  });

  it("gives textarea the same validation contract", () => {
    const html = renderToStaticMarkup(<FormField id="notes" invalid required><Textarea /></FormField>);
    expect(html).toContain('id="notes"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('required=""');
  });

  it("gives native selects the shared field contract", () => {
    const html = renderToStaticMarkup(<FormField id="scope" invalid required><NativeSelect><option>School</option></NativeSelect></FormField>);
    expect(html).toContain('id="scope"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('required=""');
  });

  it("allows an explicit control accessibility override", () => {
    const html = renderToStaticMarkup(
      <FormField id="code" invalid><Input aria-invalid={false} aria-describedby="custom-help" /></FormField>,
    );
    expect(html).toContain('aria-describedby="custom-help"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("submits from a dialog form using keyboard-equivalent submit behavior", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Account form</DialogTitle>
            <Form onSubmit={onSubmit}>
              <FormField id="dialog-name" invalid>
                <FieldLabel>Name</FieldLabel>
                <Input />
                <FieldError>Name is required</FieldError>
              </FormField>
              <Button type="submit">Save</Button>
            </Form>
          </DialogContent>
        </Dialog>,
      );
    });

    const input = document.getElementById("dialog-name") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Name is required");
    input.focus();
    expect(document.activeElement).toBe(input);

    await act(async () => {
      input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });
});
