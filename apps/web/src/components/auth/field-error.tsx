/**
 * The error message of a field.
 *
 * `role="alert"` so a screen reader announces the reason the moment it shows
 * up. With no message nothing is rendered — not even an empty gap.
 */
export function FieldError({ message }: { message?: string | undefined }) {
  if (message == null) return null;

  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
