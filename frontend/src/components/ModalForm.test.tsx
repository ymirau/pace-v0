// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import ModalForm, { TextInput } from "./ModalForm";

afterEach(cleanup);

/** Minimal ModalForm with a single named field; overridable per test. */
function renderForm(props: Partial<Parameters<typeof ModalForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const handlers = { onSubmit, onClose };
  render(
    <ModalForm
      title="Item form"
      submitLabel="Add item"
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    >
      <TextInput label="Name" defaultValue="" />
    </ModalForm>,
  );
  return handlers;
}

describe("ModalForm", () => {
  it("renders the title, the fields, and the Cancel/Submit footer", () => {
    renderForm();
    expect(screen.getByText("Item form")).toBeDefined();
    expect(screen.getByText("Name")).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Add item" })).toBeDefined();
  });

  it("fires onSubmit when the submit button is clicked", () => {
    const { onSubmit } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("fires onClose when the Cancel button is clicked", () => {
    const { onClose } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose when the × close button is clicked", () => {
    const { onClose } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the left-aligned Delete button and fires onDelete only when onDelete is provided", () => {
    const onDelete = vi.fn();
    renderForm({ onDelete });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("omits the Delete button when onDelete is not provided", () => {
    renderForm();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("renders the error banner text when error is set", () => {
    renderForm({ error: "Something went wrong" });
    expect(screen.getByText("Something went wrong")).toBeDefined();
  });

  it("shows 'Saving…' and disables submit while submitting", () => {
    renderForm({ submitting: true });
    const submit = screen.getByRole("button", { name: "Saving…" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables submit when submitDisabled is true", () => {
    renderForm({ submitDisabled: true });
    const submit = screen.getByRole("button", { name: "Add item" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows 'Deleting…' while deleting", () => {
    renderForm({ onDelete: vi.fn(), deleting: true });
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDefined();
  });
});
