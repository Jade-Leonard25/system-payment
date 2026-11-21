export function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  let closedQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        value += character;
      }
      continue;
    }

    if (
      closedQuote &&
      character !== "," &&
      character !== "\n" &&
      character !== "\r"
    ) {
      throw new Error(`Unexpected character after quoted field at ${index + 1}.`);
    }

    if (character === '"' && value.length === 0) {
      inQuotes = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
      closedQuote = false;
    } else if (character === "\n" || character === "\r") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      closedQuote = false;
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else if (character === '"') {
      throw new Error(`Unexpected quote in CSV at character ${index + 1}.`);
    } else {
      value += character;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unclosed quoted field.");
  }
  if (value.length || row.length || (source.length && !/[\r\n]$/.test(source))) {
    row.push(value);
    rows.push(row);
  }

  while (rows.length && rows.at(-1).every((cell) => cell === "")) rows.pop();
  if (!rows.length) throw new Error("The CSV file is empty.");
  return rows;
}

export function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}
