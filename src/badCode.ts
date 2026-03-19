const HIGH_VALUE_THRESHOLD = 100;

export interface Item {
  value: number;
}

function logHighValues(items: Item[]): void {
  for (const item of items) {
    if (item.value > HIGH_VALUE_THRESHOLD) {
      console.log("High value:", item.value);
    }
  }
}

function sumItemValues(items: Item[]): number {
  let total = 0;
  for (const item of items) {
    total += item.value;
  }
  return total;
}

export function calculateTotal(items: Item[]): number {
  logHighValues(items);
  return sumItemValues(items);
}

export function calculateDoubledTotal(items: Item[]): number {
  logHighValues(items);
  return sumItemValues(items) * 2;
}
