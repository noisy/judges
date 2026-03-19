const HIGH_VALUE_THRESHOLD = 100;

export interface Item {
  value: number;
}

function processItemsAndSum(items: Item[]): number {
  let total = 0;
  for (const item of items) {
    total += item.value;
    if (item.value > HIGH_VALUE_THRESHOLD) {
      console.log("High value:", item.value);
      // We removed the hidden global mutation side-effect to respect Clean Architecture
    }
  }
  return total;
}

export function calculateTotal(items: Item[]): number {
  return processItemsAndSum(items);
}

export function calculateDoubledTotal(items: Item[]): number {
  return processItemsAndSum(items) * 2;
}
