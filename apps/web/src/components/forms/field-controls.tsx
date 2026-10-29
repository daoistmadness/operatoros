import type { ReactNode } from "react";
import { FieldError } from "@/components/ui/field-error";
import { FieldLabel, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type SharedFieldProps = {
  id: string;
  label: string;
  errors?: readonly unknown[];
  required?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
};

function FieldFrame({
  id,
  label,
  errors = [],
  required = false,
  disabled = false,
  children,
}: SharedFieldProps & { children: ReactNode }) {
  const messages = errors.filter((error): error is string => typeof error === "string" && Boolean(error));

  return (
    <FormField id={id} invalid={messages.length > 0} required={required} disabled={disabled}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      <FieldError errors={messages} />
    </FormField>
  );
}

export type TextFieldProps = SharedFieldProps & {
  type?: "text" | "email" | "tel" | "date";
  value: string;
  maxLength?: number;
  onChange: (value: string) => void;
};

export function TextField({ value, onChange, maxLength, type = "text", ...props }: TextFieldProps) {
  return (
    <FieldFrame {...props}>
      <Input
        name={props.id}
        type={type}
        value={value}
        maxLength={maxLength}
        onBlur={props.onBlur}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldFrame>
  );
}

export type DateFieldProps = Omit<TextFieldProps, "type">;

export function DateField(props: DateFieldProps) {
  return <TextField {...props} type="date" />;
}

export type SelectFieldProps = SharedFieldProps & {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
};

export function SelectField({ value, onChange, children, ...props }: SelectFieldProps) {
  return (
    <FieldFrame {...props}>
      <NativeSelect
        name={props.id}
        value={value}
        onBlur={props.onBlur}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </NativeSelect>
    </FieldFrame>
  );
}
