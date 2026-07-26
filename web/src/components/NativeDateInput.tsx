import {
  createElement,
  type ComponentProps,
} from "react";

type NativeDateInputType = "date" | "datetime-local" | "time";

type NativeDateInputProps = Omit<ComponentProps<"input">, "type"> & {
  type: NativeDateInputType;
};

export function NativeDateInput({
  className,
  ...props
}: NativeDateInputProps) {
  return createElement(
    "div",
    { className: "native-date-field" },
    createElement("input", {
      ...props,
      className: ["native-date-input", className]
        .filter(Boolean)
        .join(" "),
    }),
  );
}
