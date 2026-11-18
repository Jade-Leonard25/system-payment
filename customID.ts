export function generateCustomId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const segment = () =>
    Array.from(
      { length: 3 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  return `${segment()}-${segment()}-${segment()}`;
}
