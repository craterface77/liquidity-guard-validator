export function toDateTimeString(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

export function fromDateTimeString(value: string): Date {
  return new Date(value.endsWith('Z') ? value : `${value}Z`);
}
